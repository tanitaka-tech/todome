import { useState } from "react";
import type { BalanceWheelCategory, UserProfile } from "../types";

interface Props {
  profile: UserProfile;
  setProfile: React.Dispatch<React.SetStateAction<UserProfile>>;
  send: (data: unknown) => void;
}

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

const DEFAULT_CATEGORIES = [
  "趣味",
  "人間関係",
  "健康",
  "仕事",
  "ファイナンス",
  "学び",
  "家族",
  "環境",
];

export function ProfilePanel({ profile, setProfile, send }: Props) {
  const [newCatName, setNewCatName] = useState("");

  const save = (updated: UserProfile) => {
    setProfile(updated);
    send({ type: "profile_update", profile: updated });
  };

  const updateCurrentState = (text: string) => {
    save({ ...profile, currentState: text });
  };

  const addCategory = (name: string) => {
    if (!name.trim()) return;
    const cat: BalanceWheelCategory = {
      id: genId(),
      name: name.trim(),
      ideals: [],
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

  const addIdeal = (catId: string) => {
    save({
      ...profile,
      balanceWheel: profile.balanceWheel.map((c) =>
        c.id === catId
          ? { ...c, ideals: [...c.ideals, { id: genId(), text: "" }] }
          : c,
      ),
    });
  };

  const updateIdeal = (catId: string, idealId: string, text: string) => {
    save({
      ...profile,
      balanceWheel: profile.balanceWheel.map((c) =>
        c.id === catId
          ? {
              ...c,
              ideals: c.ideals.map((i) =>
                i.id === idealId ? { ...i, text } : i,
              ),
            }
          : c,
      ),
    });
  };

  const removeIdeal = (catId: string, idealId: string) => {
    save({
      ...profile,
      balanceWheel: profile.balanceWheel.map((c) =>
        c.id === catId
          ? { ...c, ideals: c.ideals.filter((i) => i.id !== idealId) }
          : c,
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
  const suggestedCats = DEFAULT_CATEGORIES.filter((n) => !existingNames.has(n));

  return (
    <div className="profile-panel">
      <div className="page-head">
        <div className="page-head-title-wrap">
          <h1 className="page-title">自分について</h1>
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
              <span className="widget-title">バランスホイール · 理想の状態</span>
              <span className="widget-sub">
                {profile.balanceWheel.length} categories
              </span>
            </div>
            <div className="widget-body">
              <p className="profile-section-desc">
                人生の各領域における理想の自分を定義します
              </p>
              <div className="bw-categories">
                {profile.balanceWheel.map((cat) => (
                  <div key={cat.id} className="bw-category">
                    <div className="bw-category-header">
                      <span className="bw-category-name">{cat.name}</span>
                      <button
                        className="bw-category-remove"
                        onClick={() => removeCategory(cat.id)}
                        title="カテゴリを削除"
                      >
                        &times;
                      </button>
                    </div>
                    <div className="bw-ideals">
                      {cat.ideals.map((ideal) => (
                        <div key={ideal.id} className="bw-ideal-row">
                          <input
                            className="bw-ideal-input"
                            placeholder="理想の状態を入力..."
                            value={ideal.text}
                            onChange={(e) =>
                              updateIdeal(cat.id, ideal.id, e.target.value)
                            }
                          />
                          <button
                            className="bw-ideal-remove"
                            onClick={() => removeIdeal(cat.id, ideal.id)}
                          >
                            &times;
                          </button>
                        </div>
                      ))}
                      <button
                        className="bw-add-ideal"
                        onClick={() => addIdeal(cat.id)}
                      >
                        + 理想を追加
                      </button>
                    </div>
                  </div>
                ))}
              </div>

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
                  {suggestedCats.map((name) => (
                    <button
                      key={name}
                      className="bw-suggestion-chip"
                      onClick={() => addCategory(name)}
                    >
                      + {name}
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
