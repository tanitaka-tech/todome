import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useModalClose } from "../hooks/useModalClose";

interface Props {
  onClose: () => void;
}

interface ShortcutGroup {
  titleKey: string;
  items: { keys: string[]; descKey: string; chord?: boolean }[];
}

const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform);
const MOD = IS_MAC ? "⌘" : "Ctrl";

const GROUPS: ShortcutGroup[] = [
  {
    titleKey: "groupGlobal",
    items: [
      { keys: ["?"], descKey: "openHelp" },
      { keys: ["/"], descKey: "focusChat" },
      { keys: [MOD, "B"], descKey: "toggleChat" },
      { keys: ["Esc"], descKey: "closeModal" },
      { keys: ["G", "O"], descKey: "goOverview", chord: true },
      { keys: ["G", "B"], descKey: "goBoard", chord: true },
      { keys: ["G", "G"], descKey: "goGoals", chord: true },
      { keys: ["G", "R"], descKey: "goRetro", chord: true },
      { keys: ["G", "S"], descKey: "goStats", chord: true },
      { keys: ["G", "P"], descKey: "goProfile", chord: true },
      { keys: ["G", ","], descKey: "goSettings", chord: true },
    ],
  },
  {
    titleKey: "groupBoard",
    items: [
      { keys: ["N"], descKey: "addTask" },
      { keys: ["↑", "↓"], descKey: "moveSelection" },
      { keys: ["←", "→"], descKey: "moveCardColumn" },
      { keys: ["Enter"], descKey: "openCard" },
      { keys: ["Space"], descKey: "toggleTimer" },
      { keys: ["D"], descKey: "completeTask" },
      { keys: ["Delete"], descKey: "deleteTask" },
    ],
  },
  {
    titleKey: "groupChat",
    items: [
      { keys: ["Enter"], descKey: "chatSend" },
      { keys: ["Shift", "Enter"], descKey: "chatNewline" },
      { keys: [MOD, "K"], descKey: "chatClearSession" },
      { keys: [MOD, "."], descKey: "chatCancel" },
    ],
  },
  {
    titleKey: "groupRetro",
    items: [
      { keys: [MOD, "Enter"], descKey: "retroComplete" },
    ],
  },
];

export function ShortcutsHelpModal({ onClose }: Props) {
  const { t } = useTranslation("shortcuts");
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
          <h2 className="modal-title">{t("title")}</h2>
          <button className="modal-close" onClick={close} aria-label={t("close")}>
            &times;
          </button>
        </div>
        <div className="modal-body shortcuts-modal-body">
          {GROUPS.map((group) => (
            <div key={group.titleKey} className="shortcuts-group">
              <div className="shortcuts-group-title">{t(group.titleKey)}</div>
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
                    <div className="shortcuts-desc">{t(item.descKey)}</div>
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
