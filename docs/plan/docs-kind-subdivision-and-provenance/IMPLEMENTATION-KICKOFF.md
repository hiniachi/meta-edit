# Implementation kickoff — workflow-axis kinds + provenance

Status: **READY FOR IMPLEMENTATION**

仕様：`./rfc.md` （APPROVED）
影響範囲：`./research.md` （APPROVED）
論点詳細：`./open-questions.md` （APPROVED 4 件 + PAUSED 1 件）

---

## 実装 PR の進め方

別ブランチ / 別セッションで spawn 推奨。本ブランチ
（`claude/fix-chat-context-issue-oi3dk`）は仕様文書で完結。

### Landing 順

reminder-style-hooks RFC が **先 land**。本 RFC は **後 land**。
attribution（wording 改善 vs taxonomy 改善）の切り分けのため。

### 推奨ブランチ名

`claude/workflow-axis-kinds-impl`（または task system 割当）

---

## Phase 別実装サマリ

| Phase | 内容 | 主な対象 | サイズ |
|---|---|---|---|
| A | SPEC + descriptions surface（最大）| `docs/SPEC.md` Article 4 / §3 / §4 / §6 + `src/tools/descriptions.ts` から `edit_docs_only` 削除、5 新 kind の description 追加、impl 16 本に provenance guidance、`edit_cosmetic` narrow | 大 |
| B | `provenance` フィールド | `src/tools/common.ts` schema + validateRequest（§3.3.1 reject/warn 検査、§3.3.2 セル lookup、§3.3.3 cosmetic 専用 reject、citation lint） | 中 |
| C | prose obligation の `next_action` 分岐 | `src/tools/apply.ts` で provenance ごとに `next_action` を branch。**reminder-style-hooks RFC の wording principle に揃える**（`meta-edit reminder:` prefix + first-person） | 小 |
| D | 集計 + CLI | `meta-edit log --provenance` フィルタ、`meta-edit summary` に provenance 内訳、legacy `edit_docs_only` bucket | 中 |
| E（任意）| CLAUDE.md §11 補強 | prose hedging 尊重の一文追加 | 微 |
| F | external surfaces 同期 | `README*.md` × 3、`site/index.html`、`.claude-plugin/plugin.json`、`marketplace.json`、`CLAUDE.md` の「seventeen」/ `edit_docs_only` 言及全更新、`skills/typed-edit-onboarding/SKILL.md` の "seventeen" → "twenty-one" + tool 一覧更新、`session-onboarding.ts:86` の "seventeen-tool catalog" 更新 | 中 |

順序：A → B → C → D → F、E は任意で並列可能。

## 維持すべき不変条件

1. **`edit_policy_change` は無変更**（governance 軸は別検討）
2. **`hooks/hooks.json` は無変更**（hook 登録自体は触らない）
3. **既存 `edits.jsonl` への破壊変更なし**（`provenance` フィールドは optional 追加、旧エントリは null として読める）
4. **`edit_docs_only` 旧呼び出しは v0.6.0 で reject**（書き込み path）、log/summary CLI は **legacy bucket として読める**（読み出し path）
5. **§3.3 マトリクスがそのまま validation rule**：kind×prov reject/warn、additional_files cell lookup、cosmetic 専用 reject ルール
6. **パス matcher を持たない**：kind 自動推定はしない、AI 宣言のみ

## 確認用 self-check（land 直前）

- [ ] 21 ツール（15 SQLite + 1 cosmetic + 5 workflow）の登録
- [ ] `bun test` green（全 5×5 セルテスト含む）
- [ ] `bun run typecheck` clean
- [ ] `bun run build` clean、`dist/` 再生成
- [ ] external surfaces の「seventeen」言及全箇所更新
- [ ] reminder-style-hooks RFC が既に land 済みであることを確認、`next_action` 文の prose リマインダがそのスタイルに揃っていること

## バージョン bump

**v0.6.0**（minor、tool surface 拡張 + 既存 surface 廃止）。

## Q2 の扱い

`edit_cosmetic` 境界例（Q2、PAUSED）：他ツール波及の設計変更検討中。
本 RFC では §3.5 の主要 7 例で land、その設計変更が固まった
タイミングで v0.6.1 として再開。

## 次のステップ

実装完了 → v0.6.0 リリース → 数週間運用 → behavior 観察 → 必要なら
v0.6.1 で Q2 の追加例、`edit_observation` の additional_files 受理
（v0.7 候補）等を追加検討。
