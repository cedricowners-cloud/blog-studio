/**
 * 발행 파이프라인 클라이언트 — 웹 ↔ 로컬 에이전트.
 *
 * 웹은 네이버에 직접 접근하지 않는다. Supabase `jobs` 테이블을 큐로 써서
 * 사용자 PC의 로컬 에이전트가 Chrome 자동화로 실제 발행을 수행한다.
 * (브라우저에서 localhost 를 직접 호출하면 PNA/CORS/mixed-content 에 막힌다.)
 *
 * RLS 주의: `jobs` INSERT 는 account_name 이 `my_accounts()` 에 있어야
 * 통과한다. 즉 `user_accounts` 에 계정명을 먼저 등록해야 발행을 걸 수 있다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { toNaverMarkup, type NaverMarkupResult } from "./naver-markup";

export type JobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface PublishJob {
  id: string;
  type: string;
  status: JobStatus;
  account_name: string;
  agent_id: string | null;
  blog_post_id: string | null;
  payload: Record<string, unknown> | null;
  result: { success?: boolean; post_url?: string | null } | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface JobLog {
  id: number;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  created_at: string;
}

export interface AgentStatus {
  agent_id: string;
  label: string | null;
  status: "idle" | "busy" | "logging_in" | null;
  accounts: string[] | null;
  version: string | null;
  last_seen: string;
}

/** 하트비트 주기(30초)의 3배를 넘기면 끊긴 것으로 본다. */
export const AGENT_STALE_MS = 90_000;

export function isAgentOnline(agent: AgentStatus | null): boolean {
  if (!agent) return false;
  return Date.now() - new Date(agent.last_seen).getTime() < AGENT_STALE_MS;
}

// ---------------------------------------------------------------
// 계정 (user_accounts) — my_accounts() 의 소스
// ---------------------------------------------------------------

export async function listAccounts(sb: SupabaseClient): Promise<string[]> {
  const { data, error } = await sb
    .from("user_accounts")
    .select("account_name")
    .order("account_name");
  if (error) throw new Error(`계정 목록 조회 실패: ${error.message}`);
  return (data ?? []).map((r) => r.account_name as string);
}

export async function addAccount(
  sb: SupabaseClient,
  userId: string,
  accountName: string,
): Promise<void> {
  const name = accountName.trim();
  if (!name) throw new Error("계정 이름을 입력하세요.");
  // 에이전트가 쿠키 파일명(naver_<이름>.json)으로 쓰기 때문에 경로 구분자는 막는다.
  if (/[/\\]/.test(name)) {
    throw new Error("계정 이름에 / 또는 \\ 는 쓸 수 없습니다.");
  }
  const { error } = await sb
    .from("user_accounts")
    .insert({ user_id: userId, account_name: name });
  if (error) {
    if (error.code === "23505" || /duplicate/i.test(error.message)) {
      throw new Error("이미 등록된 계정 이름입니다.");
    }
    throw new Error(`계정 등록 실패: ${error.message}`);
  }
}

export async function removeAccount(
  sb: SupabaseClient,
  accountName: string,
): Promise<void> {
  const { error } = await sb
    .from("user_accounts")
    .delete()
    .eq("account_name", accountName);
  if (error) throw new Error(`계정 삭제 실패: ${error.message}`);
}

// ---------------------------------------------------------------
// 에이전트 상태
// ---------------------------------------------------------------

export async function getAgents(sb: SupabaseClient): Promise<AgentStatus[]> {
  const { data, error } = await sb
    .from("agent_heartbeat")
    .select("agent_id, label, status, accounts, version, last_seen")
    .order("last_seen", { ascending: false });
  if (error) throw new Error(`에이전트 상태 조회 실패: ${error.message}`);
  return (data ?? []) as AgentStatus[];
}

/** 폐기한 기기를 목록에서 제거. 에이전트가 다시 돌면 재등록된다. */
export async function removeAgent(
  sb: SupabaseClient,
  agentId: string,
): Promise<void> {
  const { error } = await sb
    .from("agent_heartbeat")
    .delete()
    .eq("agent_id", agentId);
  if (error) throw new Error(`에이전트 삭제 실패: ${error.message}`);
}

// ---------------------------------------------------------------
// 발행 작업
// ---------------------------------------------------------------

export interface CreatePublishJobInput {
  accountName: string;
  blogPostId: string;
  title: string;
  /** 원본 본문. 네이버 마크업 변환은 이 함수가 수행한다. */
  body: string;
  tags: string[];
  /** 네이버 "내 템플릿" 인덱스 (0-based). 미지정이면 적용 안 함. */
  templateIndex?: number | null;
  /** 에디터 체류 시간(분). 차단 회피용으로 기본 15분. */
  stayMinutes?: number;
}

export interface CreatePublishJobResult {
  job: PublishJob;
  conversion: NaverMarkupResult;
}

/**
 * 발행 작업을 큐에 넣는다.
 *
 * 본문은 여기서 한 번 네이버 마크업으로 변환해 payload 에 확정 저장한다.
 * 에이전트가 다시 해석하지 않게 하여, 실제로 올라간 내용과 사용자가 미리
 * 본 내용이 어긋나지 않도록 한다.
 */
export async function createPublishJob(
  sb: SupabaseClient,
  input: CreatePublishJobInput,
): Promise<CreatePublishJobResult> {
  const title = input.title.trim();
  if (!title) throw new Error("제목이 비어 있습니다.");

  const conversion = toNaverMarkup(input.body);
  if (!conversion.markup.trim()) {
    throw new Error("변환 후 본문이 비었습니다. 원본 내용을 확인하세요.");
  }

  // 네이버 태그는 30개까지. 특수문자는 에이전트가 제거하지만 여기서도 정리.
  const tags = input.tags
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 30);

  const { data, error } = await sb
    .from("jobs")
    .insert({
      type: "publish",
      account_name: input.accountName,
      blog_post_id: input.blogPostId,
      status: "pending",
      payload: {
        account_name: input.accountName,
        blog_post_id: input.blogPostId,
        title,
        body: conversion.markup,
        tags,
        template_index: input.templateIndex ?? null,
        stay_minutes: input.stayMinutes ?? 15,
      },
    })
    .select("*")
    .single();

  if (error) {
    // RLS 위반은 메시지가 모호하게 나오므로 원인을 짚어준다.
    if (/row-level security|violates/i.test(error.message)) {
      throw new Error(
        `발행 작업 생성이 거부되었습니다 — "${input.accountName}" 계정이 ` +
          `등록되어 있는지 확인하세요. (설정 → 발행 에이전트)`,
      );
    }
    throw new Error(`발행 작업 생성 실패: ${error.message}`);
  }

  return { job: data as PublishJob, conversion };
}

export async function listJobsForPost(
  sb: SupabaseClient,
  blogPostId: string,
): Promise<PublishJob[]> {
  const { data, error } = await sb
    .from("jobs")
    .select("*")
    .eq("blog_post_id", blogPostId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`발행 작업 조회 실패: ${error.message}`);
  return (data ?? []) as PublishJob[];
}

export async function listRecentJobs(
  sb: SupabaseClient,
  limit = 20,
): Promise<PublishJob[]> {
  const { data, error } = await sb
    .from("jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`작업 목록 조회 실패: ${error.message}`);
  return (data ?? []) as PublishJob[];
}

export async function getJobLogs(
  sb: SupabaseClient,
  jobId: string,
): Promise<JobLog[]> {
  const { data, error } = await sb
    .from("job_logs")
    .select("id, level, message, created_at")
    .eq("job_id", jobId)
    .order("created_at");
  if (error) throw new Error(`작업 로그 조회 실패: ${error.message}`);
  return (data ?? []) as JobLog[];
}

export async function cancelJob(
  sb: SupabaseClient,
  jobId: string,
): Promise<void> {
  // pending 일 때만 취소. 이미 running 이면 브라우저가 돌고 있어서
  // 여기서 상태만 바꿔도 실제 작업은 멈추지 않는다.
  const { error } = await sb
    .from("jobs")
    .update({ status: "cancelled" })
    .eq("id", jobId)
    .eq("status", "pending");
  if (error) throw new Error(`작업 취소 실패: ${error.message}`);
}

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  pending: "대기 중",
  running: "진행 중",
  completed: "완료",
  failed: "실패",
  cancelled: "취소됨",
};
