import { useRef } from "react";
import { useModalClose } from "../hooks/useModalClose";

interface Props {
  onClose: () => void;
}

interface ShortcutGroup {
  title: string;
  items: { keys: string[]; desc: string; chord?: boolean }[];
}

const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform);
const MOD = IS_MAC ? "⌘" : "Ctrl";

const GROUPS: ShortcutGroup[] = [
  {
    title: "グローバル",
    items: [
      { keys: ["?"], desc: "このヘルプを開く" },
      { keys: ["/"], desc: "AIアシスタントにフォーカス" },
      { keys: [MOD, "B"], desc: "AIアシスタントの開閉" },
      { keys: ["Esc"], desc: "モーダル / フォーカスを閉じる" },
      { keys: ["G", "O"], desc: "Overview へ移動", chord: true },
      { keys: ["G", "B"], desc: "ボードへ移動", chord: true },
      { keys: ["G", "G"], desc: "目標へ移動", chord: true },
      { keys: ["G", "R"], desc: "振り返りへ移動", chord: true },
      { keys: ["G", "S"], desc: "統計へ移動", chord: true },
      { keys: ["G", "P"], desc: "プロフィールへ移動", chord: true },
      { keys: ["G", ","], desc: "設定へ移動", chord: true },
    ],
  },
  {
    title: "ボード",
    items: [
      { keys: ["N"], desc: "新しいタスクを追加" },
      { keys: ["↑", "↓"], desc: "カード選択を上下に移動" },
      { keys: ["←", "→"], desc: "カードを前後のカラムへ移動" },
      { keys: ["Enter"], desc: "選択中のカードを開く" },
      { keys: ["Space"], desc: "選択中のタスクのタイマーを開始/停止" },
      { keys: ["D"], desc: "選択中のタスクを完了にする" },
      { keys: ["Delete"], desc: "選択中のタスクを削除" },
    ],
  },
  {
    title: "AIチャット",
    items: [
      { keys: ["Enter"], desc: "送信" },
      { keys: ["Shift", "Enter"], desc: "改行" },
      { keys: [MOD, "K"], desc: "セッションをクリア" },
      { keys: [MOD, "."], desc: "生成をキャンセル" },
    ],
  },
  {
    title: "振り返り",
    items: [
      { keys: [MOD, "Enter"], desc: "振り返りを完了" },
    ],
  },
];

export function ShortcutsHelpModal({ onClose }: Props) {
  const { closing, close } = useModalClose(onClose);
  const overlayDownRef = useRef(false);

  return (
    <div
      className={`modal-overlay${closing ? " is-closing" : ""}`}
      onMouseDown={(e) => {
        overlayDownRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && overlayDownRef.current) {
          close();
        }
      }}
    >
      <div
        className="modal-content shortcuts-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title">キーボードショートカット</h2>
          <button className="modal-close" onClick={close} aria-label="閉じる">
            &times;
          </button>
        </div>
        <div className="modal-body shortcuts-modal-body">
          {GROUPS.map((group) => (
            <div key={group.title} className="shortcuts-group">
              <div className="shortcuts-group-title">{group.title}</div>
              <div className="shortcuts-list">
                {group.items.map((item, idx) => (
                  <div key={idx} className="shortcuts-row">
                    <div className="shortcuts-keys">
                      {item.keys.map((k, i) => (
                        <span key={i} className="shortcuts-key-wrap">
                          {i > 0 && (
                            <span className="shortcuts-sep">
                              {item.chord ? "→" : "+"}
                            </span>
                          )}
                          <kbd className="shortcuts-kbd">{k}</kbd>
                        </span>
                      ))}
                    </div>
                    <div className="shortcuts-desc">{item.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
