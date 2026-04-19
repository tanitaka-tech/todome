import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import EmojiPicker, { EmojiStyle, Theme } from "emoji-picker-react";
import type { BalanceWheelCategory, UserProfile } from "../types";
import { DARK_THEMES, type ThemeName } from "../theme";

const DIAGRAM_SIZE = 280;
const DIAGRAM_CENTER = DIAGRAM_SIZE / 2;
const DIAGRAM_MAX_RADIUS = 100;
const DIAGRAM_UNIT = DIAGRAM_MAX_RADIUS / 10;
const GRID_STEPS = [2, 4, 6, 8, 10];

interface Props {
  profile: UserProfile;
  setProfile: React.Dispatch<React.SetStateAction<UserProfile>>;
  send: (data: unknown) => void;
}

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

function getCategoryScore(cat: BalanceWheelCategory): number {
  const s = typeof cat.score === "number" ? cat.score : 5;
  return Math.max(1, Math.min(10, Math.round(s)));
}

function vertexAngle(index: number, total: number): number {
  return (Math.PI * 2 * index) / total - Math.PI / 2;
}

function vertexPoint(index: number, total: number, radius: number) {
  const angle = vertexAngle(index, total);
  return {
    x: DIAGRAM_CENTER + Math.cos(angle) * radius,
    y: DIAGRAM_CENTER + Math.sin(angle) * radius,
  };
}

function normalizeAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

function BalanceDiagram({
  categories,
  onScoreChange,
  onSelectCategory,
  selectedCatId,
}: {
  categories: BalanceWheelCategory[];
  onScoreChange: (catId: string, score: number) => void;
  onSelectCategory: (catId: string) => void;
  selectedCatId: string | null;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const n = categories.length;

  if (n < 3) {
    return (
      <div className="bw-diagram-empty">
        カテゴリを3つ以上追加するとダイヤグラムが表示されます
      </div>
    );
  }

  const toSvgCoords = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * DIAGRAM_SIZE,
      y: ((clientY - rect.top) / rect.height) * DIAGRAM_SIZE,
    };
  };

  const findNearestAxis = (sx: number, sy: number) => {
    const dx = sx - DIAGRAM_CENTER;
    const dy = sy - DIAGRAM_CENTER;
    const angle = Math.atan2(dy, dx);
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < n; i++) {
      const diff = Math.abs(normalizeAngle(angle - vertexAngle(i, n)));
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    }
    return best;
  };

  const scoreFromPoint = (idx: number, sx: number, sy: number) => {
    const dx = sx - DIAGRAM_CENTER;
    const dy = sy - DIAGRAM_CENTER;
    const a = vertexAngle(idx, n);
    const projection = dx * Math.cos(a) + dy * Math.sin(a);
    return Math.max(1, Math.min(10, Math.round(projection / DIAGRAM_UNIT)));
  };

  const applyPointer = (idx: number, clientX: number, clientY: number) => {
    const p = toSvgCoords(clientX, clientY);
    if (!p) return;
    const newScore = scoreFromPoint(idx, p.x, p.y);
    if (newScore !== getCategoryScore(categories[idx])) {
      onScoreChange(categories[idx].id, newScore);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = toSvgCoords(e.clientX, e.clientY);
    if (!p) return;
    const idx = findNearestAxis(p.x, p.y);
    setDraggingIdx(idx);
    e.currentTarget.setPointerCapture(e.pointerId);
    applyPointer(idx, e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (draggingIdx === null) return;
    applyPointer(draggingIdx, e.clientX, e.clientY);
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (draggingIdx === null) return;
    setDraggingIdx(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const shapePoints = categories
    .map((cat, i) => {
      const p = vertexPoint(i, n, DIAGRAM_UNIT * getCategoryScore(cat));
      return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${DIAGRAM_SIZE} ${DIAGRAM_SIZE}`}
      className={`bw-diagram-svg ${draggingIdx !== null ? "is-dragging" : ""}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {GRID_STEPS.map((step) => {
        const r = DIAGRAM_UNIT * step;
        const pts = Array.from({ length: n }, (_, i) => {
          const p = vertexPoint(i, n, r);
          return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
        }).join(" ");
        return (
          <polygon
            key={step}
            points={pts}
            className={`bw-diagram-grid bw-diagram-grid-${step}`}
          />
        );
      })}
      {categories.map((cat, i) => {
        const p = vertexPoint(i, n, DIAGRAM_MAX_RADIUS);
        return (
          <line
            key={`ax-${cat.id}`}
            x1={DIAGRAM_CENTER}
            y1={DIAGRAM_CENTER}
            x2={p.x}
            y2={p.y}
            className="bw-diagram-axis"
          />
        );
      })}
      <polygon points={shapePoints} className="bw-diagram-shape" />
      {categories.map((cat, i) => {
        const score = getCategoryScore(cat);
        const p = vertexPoint(i, n, DIAGRAM_UNIT * score);
        const isActive = draggingIdx === i;
        return (
          <g key={`h-${cat.id}`} className="bw-diagram-handle-group">
            <circle
              cx={p.x}
              cy={p.y}
              r={14}
              className="bw-diagram-handle-hit"
            />
            <circle
              cx={p.x}
              cy={p.y}
              r={isActive ? 7 : 5}
              className={`bw-diagram-handle ${isActive ? "is-active" : ""}`}
            />
          </g>
        );
      })}
      {categories.map((cat, i) => {
        const labelP = vertexPoint(i, n, DIAGRAM_MAX_RADIUS + 24);
        const score = getCategoryScore(cat);
        const hasIcon = !!cat.icon;
        const label =
          cat.name.length > 8 ? cat.name.slice(0, 8) + "…" : cat.name;
        const isSelected = selectedCatId === cat.id;
        return (
          <g
            key={`l-${cat.id}`}
            className={`bw-diagram-label-group ${isSelected ? "is-selected" : ""}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onSelectCategory(cat.id);
            }}
          >
            <rect
              x={labelP.x - 42}
              y={labelP.y - (hasIcon ? 22 : 14)}
              width={84}
              height={hasIcon ? 44 : 28}
              rx={4}
              className="bw-diagram-label-bg"
            />
            {hasIcon && (
              <text
                x={labelP.x}
                y={labelP.y - 11}
                className="bw-diagram-label-icon"
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {cat.icon}
              </text>
            )}
            <text
              x={labelP.x}
              y={hasIcon ? labelP.y + 4 : labelP.y - 5}
              className="bw-diagram-label"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {label}
            </text>
            <text
              x={labelP.x}
              y={hasIcon ? labelP.y + 16 : labelP.y + 7}
              className="bw-diagram-label-score"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {score}/10
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const DEFAULT_CATEGORIES: { name: string; icon: string }[] = [
  { name: "趣味", icon: "🎨" },
  { name: "人間関係", icon: "💖" },
  { name: "健康", icon: "💪" },
  { name: "仕事", icon: "💼" },
  { name: "ファイナンス", icon: "💰" },
  { name: "学び", icon: "📚" },
  { name: "家族", icon: "👨‍👩‍👧" },
  { name: "環境", icon: "🌱" },
];

function getEmojiPickerTheme(): Theme {
  if (typeof document === "undefined") return Theme.AUTO;
  const t = document.documentElement.getAttribute("data-theme") as ThemeName | null;
  if (!t) return Theme.AUTO;
  return DARK_THEMES.includes(t) ? Theme.DARK : Theme.LIGHT;
}

export function ProfilePanel({ profile, setProfile, send }: Props) {
  const [newCatName, setNewCatName] = useState("");
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [pickerStyle, setPickerStyle] = useState<React.CSSProperties | null>(
    null,
  );
  const editingInputRef = useRef<HTMLInputElement>(null);
  const iconWrapRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!iconPickerOpen) return;
    const compute = () => {
      const el = iconWrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const gap = 8;
      const width = Math.min(340, window.innerWidth - 16);
      const left = Math.max(
        8,
        Math.min(r.left, window.innerWidth - width - 8),
      );
      setPickerStyle({
        position: "fixed",
        left,
        bottom: window.innerHeight - r.top + gap,
        width,
        zIndex: 1000,
      });
    };
    compute();
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      const inWrap = iconWrapRef.current?.contains(t);
      const inPicker = pickerRef.current?.contains(t);
      if (!inWrap && !inPicker) setIconPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIconPickerOpen(false);
    };
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
      setPickerStyle(null);
    };
  }, [iconPickerOpen]);
  const cleanedRef = useRef(false);

  const save = (updated: UserProfile) => {
    setProfile(updated);
    send({ type: "profile_update", profile: updated });
  };

  // Legacy cleanup: old balanceWheel entries had `ideals` — strip them once.
  useEffect(() => {
    if (cleanedRef.current) return;
    const hasLegacy = profile.balanceWheel.some((c) =>
      Object.prototype.hasOwnProperty.call(c, "ideals"),
    );
    if (hasLegacy) {
      const cleaned: BalanceWheelCategory[] = profile.balanceWheel.map((c) => ({
        id: c.id,
        name: c.name,
        score: typeof c.score === "number" ? c.score : 5,
      }));
      save({ ...profile, balanceWheel: cleaned });
    }
    cleanedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateCurrentState = (text: string) => {
    save({ ...profile, currentState: text });
  };

  const addCategory = (name: string, icon?: string) => {
    if (!name.trim()) return;
    const cat: BalanceWheelCategory = {
      id: genId(),
      name: name.trim(),
      score: 5,
      ...(icon ? { icon } : {}),
    };
    save({ ...profile, balanceWheel: [...profile.balanceWheel, cat] });
    setNewCatName("");
  };

  const removeCategory = (catId: string) => {
    save({
      ...profile,
      balanceWheel: profile.balanceWheel.filter((c) => c.id !== catId),
    });
  };

  const renameCategory = (catId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    save({
      ...profile,
      balanceWheel: profile.balanceWheel.map((c) =>
        c.id === catId ? { ...c, name: trimmed } : c,
      ),
    });
  };

  const updateCategoryIcon = (catId: string, icon: string) => {
    save({
      ...profile,
      balanceWheel: profile.balanceWheel.map((c) =>
        c.id === catId
          ? icon
            ? { ...c, icon }
            : (() => {
                const rest = { ...c };
                delete rest.icon;
                return rest;
              })()
          : c,
      ),
    });
  };

  const openEditor = (catId: string) => {
    const cat = profile.balanceWheel.find((c) => c.id === catId);
    if (!cat) return;
    setEditingCatId(catId);
    setEditingName(cat.name);
    setTimeout(() => editingInputRef.current?.select(), 0);
  };

  const closeEditor = () => {
    setEditingCatId(null);
    setEditingName("");
    setIconPickerOpen(false);
  };

  const commitEditorName = () => {
    if (editingCatId) renameCategory(editingCatId, editingName);
    closeEditor();
  };

  const deleteFromEditor = () => {
    if (editingCatId) removeCategory(editingCatId);
    closeEditor();
  };

  const updateCategoryScore = (catId: string, score: number) => {
    const clamped = Math.max(1, Math.min(10, Math.round(score)));
    save({
      ...profile,
      balanceWheel: profile.balanceWheel.map((c) =>
        c.id === catId ? { ...c, score: clamped } : c,
      ),
    });
  };

  const addPrinciple = () => {
    save({
      ...profile,
      actionPrinciples: [
        ...profile.actionPrinciples,
        { id: genId(), text: "" },
      ],
    });
  };

  const updatePrinciple = (id: string, text: string) => {
    save({
      ...profile,
      actionPrinciples: profile.actionPrinciples.map((p) =>
        p.id === id ? { ...p, text } : p,
      ),
    });
  };

  const removePrinciple = (id: string) => {
    save({
      ...profile,
      actionPrinciples: profile.actionPrinciples.filter((p) => p.id !== id),
    });
  };

  const addWant = () => {
    save({
      ...profile,
      wantToDo: [...profile.wantToDo, { id: genId(), text: "" }],
    });
  };

  const updateWant = (id: string, text: string) => {
    save({
      ...profile,
      wantToDo: profile.wantToDo.map((w) =>
        w.id === id ? { ...w, text } : w,
      ),
    });
  };

  const removeWant = (id: string) => {
    save({
      ...profile,
      wantToDo: profile.wantToDo.filter((w) => w.id !== id),
    });
  };

  const existingNames = new Set(profile.balanceWheel.map((c) => c.name));
  const suggestedCats = DEFAULT_CATEGORIES.filter(
    (d) => !existingNames.has(d.name),
  );

  return (
    <div className="profile-panel">
      <div className="page-head">
        <div className="page-head-title-wrap">
          <h1 className="page-title">プロフィール</h1>
          <div className="page-subtitle">
            AIアシスタントのコンテキストとして使われます
          </div>
        </div>
      </div>

      <div className="page-body">
        <div className="overview-grid">
          {/* 現在の自分の状態 */}
          <div className="widget col-12">
            <div className="widget-head">
              <span className="widget-title">現在の自分の状態</span>
            </div>
            <div className="widget-body">
              <textarea
                className="profile-textarea"
                rows={3}
                placeholder="例: Unityエンジニアで、個人でもゲームを作っているが完璧主義でなかなか進まない"
                value={profile.currentState}
                onChange={(e) => updateCurrentState(e.target.value)}
              />
            </div>
          </div>

          {/* バランスホイール */}
          <div className="widget col-12">
            <div className="widget-head">
              <span className="widget-title">バランスホイール</span>
              <span className="widget-sub">
                {profile.balanceWheel.length} categories
              </span>
            </div>
            <div className="widget-body">
              <p className="profile-section-desc">
                人生の各領域の現在の充実度を1〜10で評価します。頂点をドラッグでスコアを調整、カテゴリ名をクリックで編集・削除できます。
              </p>
              <div className="bw-diagram-wrap">
                <BalanceDiagram
                  categories={profile.balanceWheel}
                  onScoreChange={updateCategoryScore}
                  onSelectCategory={openEditor}
                  selectedCatId={editingCatId}
                />
              </div>

              {editingCatId && (() => {
                const editingCat = profile.balanceWheel.find(
                  (c) => c.id === editingCatId,
                );
                const currentIcon = editingCat?.icon ?? "";
                return (
                  <div className="bw-cat-editor">
                    <div className="bw-cat-editor-row">
                      <div
                        className="bw-cat-editor-icon-wrap"
                        ref={iconWrapRef}
                      >
                        <button
                          type="button"
                          className={`bw-cat-editor-icon-btn ${iconPickerOpen ? "is-active" : ""}`}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => setIconPickerOpen((v) => !v)}
                          title="アイコンを選択"
                          aria-label="アイコンを選択"
                        >
                          {currentIcon || (
                            <span className="bw-cat-editor-icon-placeholder">
                              🙂
                            </span>
                          )}
                        </button>
                        {iconPickerOpen &&
                          pickerStyle &&
                          createPortal(
                            <div
                              ref={pickerRef}
                              className="bw-cat-editor-picker"
                              style={pickerStyle}
                              onMouseDown={(e) => {
                                const t = e.target as HTMLElement;
                                if (
                                  t.tagName === "INPUT" ||
                                  t.tagName === "TEXTAREA"
                                )
                                  return;
                                e.preventDefault();
                              }}
                            >
                              <div className="bw-cat-editor-picker-head">
                                <button
                                  type="button"
                                  className="bw-cat-editor-icon-clear"
                                  onClick={() => {
                                    updateCategoryIcon(editingCatId, "");
                                    setIconPickerOpen(false);
                                  }}
                                >
                                  アイコンなし
                                </button>
                              </div>
                              <EmojiPicker
                                onEmojiClick={(data) => {
                                  updateCategoryIcon(editingCatId, data.emoji);
                                  setIconPickerOpen(false);
                                }}
                                theme={getEmojiPickerTheme()}
                                emojiStyle={EmojiStyle.NATIVE}
                                searchPlaceHolder="検索"
                                lazyLoadEmojis
                                width="100%"
                                height={380}
                                previewConfig={{ showPreview: false }}
                                autoFocusSearch={false}
                              />
                            </div>,
                            document.body,
                          )}
                      </div>
                      <input
                        ref={editingInputRef}
                        className="bw-cat-editor-input"
                        value={editingName}
                        placeholder="カテゴリ名"
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={(e) => {
                          const related = e.relatedTarget as HTMLElement | null;
                          const editorEl =
                            e.currentTarget.closest(".bw-cat-editor");
                          const inEditor =
                            !!related && !!editorEl?.contains(related);
                          const inPicker =
                            !!related && !!pickerRef.current?.contains(related);
                          if (inEditor || inPicker) {
                            // Focus moved to picker (portaled) or another editor element; save name only
                            if (editingCatId)
                              renameCategory(editingCatId, editingName);
                            return;
                          }
                          commitEditorName();
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitEditorName();
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            closeEditor();
                          }
                        }}
                        autoFocus
                      />
                      <button
                        type="button"
                        className="bw-cat-editor-delete"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={deleteFromEditor}
                      >
                        削除
                      </button>
                      <button
                        type="button"
                        className="bw-cat-editor-close"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={closeEditor}
                        aria-label="閉じる"
                        title="閉じる"
                      >
                        &times;
                      </button>
                    </div>
                  </div>
                );
              })()}

              <div className="bw-add-category">
                <input
                  className="bw-cat-input"
                  placeholder="カテゴリ名を入力..."
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addCategory(newCatName);
                  }}
                />
                <button
                  className="bw-cat-submit"
                  onClick={() => addCategory(newCatName)}
                >
                  追加
                </button>
              </div>
              {suggestedCats.length > 0 && (
                <div className="bw-suggestions">
                  {suggestedCats.map((s) => (
                    <button
                      key={s.name}
                      className="bw-suggestion-chip"
                      onClick={() => addCategory(s.name, s.icon)}
                    >
                      + {s.icon} {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 行動指針 */}
          <div className="widget col-6">
            <div className="widget-head">
              <span className="widget-title">心がけたい行動指針</span>
              <span className="widget-sub">
                {profile.actionPrinciples.length}
              </span>
            </div>
            <div className="widget-body">
              <div className="profile-list">
                {profile.actionPrinciples.map((p) => (
                  <div key={p.id} className="profile-list-row">
                    <input
                      className="profile-list-input"
                      placeholder="例: 常に「今やれること」に集中する"
                      value={p.text}
                      onChange={(e) => updatePrinciple(p.id, e.target.value)}
                    />
                    <button
                      className="profile-list-remove"
                      onClick={() => removePrinciple(p.id)}
                    >
                      &times;
                    </button>
                  </div>
                ))}
                <button className="profile-list-add" onClick={addPrinciple}>
                  + 行動指針を追加
                </button>
              </div>
            </div>
          </div>

          {/* やりたいこと */}
          <div className="widget col-6">
            <div className="widget-head">
              <span className="widget-title">やりたいこと</span>
              <span className="widget-sub">{profile.wantToDo.length}</span>
            </div>
            <div className="widget-body">
              <div className="profile-list">
                {profile.wantToDo.map((w) => (
                  <div key={w.id} className="profile-list-row">
                    <input
                      className="profile-list-input"
                      placeholder="例: Godotで作品を作る"
                      value={w.text}
                      onChange={(e) => updateWant(w.id, e.target.value)}
                    />
                    <button
                      className="profile-list-remove"
                      onClick={() => removeWant(w.id)}
                    >
                      &times;
                    </button>
                  </div>
                ))}
                <button className="profile-list-add" onClick={addWant}>
                  + やりたいことを追加
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
