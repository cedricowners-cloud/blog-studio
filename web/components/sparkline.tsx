/**
 * 의존성 없는 SVG sparkline / line chart.
 *
 * <Sparkline data={[10,20,30]} /> — 컴팩트 (50x20)
 * <LineChart data={[{label, value}]} /> — 라벨 포함 큰 차트 (트렌드 모달용)
 */

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
}

export function Sparkline({
  data,
  width = 80,
  height = 24,
  stroke = "#1E3A8A",
  fill = "rgba(30, 58, 138, 0.12)",
}: SparklineProps) {
  if (data.length < 2) {
    return <span className="inline-block text-neutral-300 text-[10px]">—</span>;
  }
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const linePath = `M ${points.join(" L ")}`;
  const areaPath = `${linePath} L ${width},${height} L 0,${height} Z`;

  return (
    <svg width={width} height={height} className="inline-block align-middle">
      <path d={areaPath} fill={fill} stroke="none" />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

interface LineChartProps {
  data: Array<{ label: string; value: number }>;
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
}

/**
 * 라벨·축 포함 큰 차트. 트렌드 모달에 사용.
 */
export function LineChart({
  data,
  width = 600,
  height = 240,
  stroke = "#1E3A8A",
  fill = "rgba(30, 58, 138, 0.10)",
}: LineChartProps) {
  if (data.length < 2) {
    return <p className="text-sm text-neutral-400 py-8 text-center">데이터가 부족합니다.</p>;
  }
  const padTop = 16;
  const padBottom = 32;
  const padLeft = 36;
  const padRight = 12;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  const values = data.map((d) => d.value);
  const max = Math.max(...values, 1);
  const min = 0; // DataLab 비율은 0이 floor
  const range = max - min || 1;
  const stepX = innerW / (data.length - 1);

  const points = data.map((d, i) => {
    const x = padLeft + i * stepX;
    const y = padTop + innerH - ((d.value - min) / range) * innerH;
    return { x, y, ...d };
  });

  const linePath = `M ${points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L ")}`;
  const areaPath = `${linePath} L ${points[points.length - 1].x},${padTop + innerH} L ${points[0].x},${padTop + innerH} Z`;

  // Y축 눈금 (0, 50, 100 비율 가정)
  const yTicks = [0, max * 0.25, max * 0.5, max * 0.75, max].map((v) => ({
    v,
    y: padTop + innerH - ((v - min) / range) * innerH,
  }));

  // X축 라벨: 첫·중간·마지막만 (조밀 방지)
  const xLabelIndices = data.length <= 6
    ? data.map((_, i) => i)
    : [0, Math.floor(data.length / 4), Math.floor(data.length / 2), Math.floor((3 * data.length) / 4), data.length - 1];

  return (
    <svg width={width} height={height} className="block max-w-full">
      {/* Y축 눈금 + 가로 격자 */}
      {yTicks.map((t) => (
        <g key={t.v}>
          <line
            x1={padLeft}
            x2={width - padRight}
            y1={t.y}
            y2={t.y}
            stroke="#E5E7EB"
            strokeDasharray="2,2"
          />
          <text x={padLeft - 6} y={t.y + 3} textAnchor="end" className="fill-neutral-400 text-[10px]">
            {Math.round(t.v)}
          </text>
        </g>
      ))}

      {/* 영역 + 선 */}
      <path d={areaPath} fill={fill} />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" />

      {/* 데이터 포인트 + tooltip (title) */}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={3} fill={stroke}>
            <title>{`${p.label}: ${p.value.toFixed(1)}`}</title>
          </circle>
        </g>
      ))}

      {/* X축 라벨 */}
      {xLabelIndices.map((i) => {
        const p = points[i];
        return (
          <text
            key={i}
            x={p.x}
            y={height - padBottom + 14}
            textAnchor="middle"
            className="fill-neutral-500 text-[10px]"
          >
            {p.label}
          </text>
        );
      })}
    </svg>
  );
}
