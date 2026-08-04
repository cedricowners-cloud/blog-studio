import tkinter as tk
from tkinter import scrolledtext, messagebox
from keywords_analysis import get_youtube_transcript


def on_fetch():
    url = url_entry.get()
    try:
        script = get_youtube_transcript(url)
        output_area.delete('1.0', tk.END)
        if script:
            output_area.insert(tk.END, script)
        else:
            messagebox.showwarning("경고", "자막을 가져올 수 없습니다.")
    except Exception as e:
        messagebox.showerror("오류", str(e))


# GUI 설정
root = tk.Tk()
root.title("유튜브 스크립트 추출기")
root.geometry("600x500")

url_label = tk.Label(root, text="유튜브 링크:")
url_label.pack(pady=(10, 0))

url_entry = tk.Entry(root, width=80)
url_entry.pack(pady=(0, 10))

fetch_button = tk.Button(root, text="스크립트 추출", command=on_fetch)
fetch_button.pack(pady=(0, 10))

output_area = scrolledtext.ScrolledText(root, wrap=tk.WORD, width=70, height=25)
output_area.pack(padx=10, pady=10, fill=tk.BOTH, expand=True)

root.mainloop()
