import { describe, expect, it } from 'vitest';

import {
  applyPodDraftPref,
  computePodNewMakerDefaultsSeed,
  podSeedToDraftSnapshot,
} from '../podNewMakerDefaultsSeed.js';

const session = (agentKind: string, model: string | null, updatedAt: number) => ({
  agentKind,
  model,
  updatedAt,
});

describe('pod new-maker defaults seed', () => {
  it('follows the most recent model this Pod actually used, per vendor', () => {
    const seed = computePodNewMakerDefaultsSeed({
      recentSessions: [
        session('cc', 'claude-opus-5', 300),
        session('cc', 'claude-sonnet-4-6', 100),
        session('codex', 'gpt-5.6-sol', 200),
      ],
    });
    expect(seed.lastByVendor.cc).toEqual({ model: 'claude-opus-5' });
    expect(seed.lastByVendor.codex).toEqual({ model: 'gpt-5.6-sol' });
  });

  // sessions.agent_kind 历史上同时存在 'cc' 与 'claude-code' 两种写法,漏掉任一种都会让
  // 「有习惯」被误判成「无习惯」而落到目录默认。
  it('accepts both stored spellings of the claude-code vendor', () => {
    const seed = computePodNewMakerDefaultsSeed({
      recentSessions: [session('claude-code', 'claude-opus-5', 10)],
    });
    expect(seed.lastByVendor.cc).toEqual({ model: 'claude-opus-5' });
    expect(seed.modelChosenByVendor.cc).toBeUndefined();
  });

  // 有历史的 vendor 必须**不带** modelChosenByVendor:控制端在 === false 时优先用目录标记的
  // 新对话默认(markedDefault ?? remoteDraft.model),声明 false 会把刚播种的习惯值盖掉。
  it('leaves a vendor with history unmarked so its seeded model wins', () => {
    const seed = computePodNewMakerDefaultsSeed({
      recentSessions: [session('codex', 'gpt-5.6-sol', 5)],
    });
    expect(seed.lastByVendor.codex).toEqual({ model: 'gpt-5.6-sol' });
    expect(seed.modelChosenByVendor).toEqual({ cc: false, pi: false });
  });

  // 新建实例的 userData 是空的,首次必然走这里:三个 vendor 全部声明「明确未选过」,
  // 让控制端已有的 newSessionDefault 目录默认生效,而不是回落 availableModels[0]。
  it('marks every vendor unchosen when this Pod has no history', () => {
    const seed = computePodNewMakerDefaultsSeed({ recentSessions: [] });
    expect(seed.lastByVendor).toEqual({});
    expect(seed.modelChosenByVendor).toEqual({ cc: false, codex: false, pi: false });
  });

  it('ignores unusable rows instead of seeding an empty model', () => {
    const seed = computePodNewMakerDefaultsSeed({
      recentSessions: [
        session('cc', '', 100),
        session('cc', '   ', 200),
        session('cc', null, 300),
        session('unknown-vendor', 'some-model', 400),
      ],
    });
    expect(seed.lastByVendor).toEqual({});
    expect(seed.modelChosenByVendor).toEqual({ cc: false, codex: false, pi: false });
  });

  // 只填 model:effort / fast / providerId 各有自己的回落链,凭历史臆造会顶掉控制端的
  // capabilities 默认。
  it('seeds only the model and leaves other prefs to their own fallbacks', () => {
    const seed = computePodNewMakerDefaultsSeed({
      recentSessions: [session('cc', 'claude-opus-5', 1)],
    });
    expect(Object.keys(seed.lastByVendor.cc ?? {})).toEqual(['model']);
  });

  // 播种出的快照要能直接喂 setNewMakerDraftCache:两张按模型的记忆表必填,
  // 空表 = 「本 Pod 没记过任何模型级预设」,不是缺字段。
  it('produces a draft snapshot the cache can take as-is', () => {
    const snapshot = podSeedToDraftSnapshot(
      computePodNewMakerDefaultsSeed({ recentSessions: [session('pi', 'pi-model', 1)] }),
    );
    expect(snapshot).toEqual({
      lastByVendor: { pi: { model: 'pi-model' } },
      modelChosenByVendor: { cc: false, codex: false },
      fastModeByModel: {},
      effortByModel: {},
    });
  });

  // 播种后用户再显式选一次:必须能把 false 翻成 true,否则控制端会以为「从未选过」而
  // 在下次 capabilities 变化时把用户的选择重新校准回目录默认。
  it('lets an explicit choice flip a seeded unchosen vendor to chosen', () => {
    const seeded = podSeedToDraftSnapshot(
      computePodNewMakerDefaultsSeed({ recentSessions: [] }),
    );
    expect(seeded.modelChosenByVendor?.cc).toBe(false);
    const applied = applyPodDraftPref(seeded, {
      agent: 'claude-code',
      modelId: 'claude-opus-5',
      active: true,
    });
    expect(applied.modelChosenByVendor?.cc).toBe(true);
    expect(applied.lastByVendor.cc?.model).toBe('claude-opus-5');
    // 其它 vendor 不受影响,仍然让位给目录默认。
    expect(applied.modelChosenByVendor?.codex).toBe(false);
  });

  // 写那一半:控制端选的模型必须真的留下来。普通桌面由 renderer 完成这一步并经
  // SYNC_NEW_MAKER_DRAFT 回写;Pod 没有窗口,DRAFT_PREF_APPLY 广播给零个接收者,
  // 所以 main 必须自己闭环 —— 否则用户每次选完,下次新建又回到默认。
  it('remembers an explicitly chosen model so it survives the next new draft', () => {
    const first = applyPodDraftPref(null, {
      agent: 'claude-code',
      modelId: 'claude-opus-5',
      active: true,
    });
    expect(first.lastByVendor.cc?.model).toBe('claude-opus-5');
    expect(first.modelChosenByVendor?.cc).toBe(true);

    // 再选一次要覆盖,而不是叠加出两个「当前模型」。
    const second = applyPodDraftPref(first, {
      agent: 'claude-code',
      modelId: 'claude-sonnet-4-6',
      active: true,
    });
    expect(second.lastByVendor.cc?.model).toBe('claude-sonnet-4-6');
  });

  // active=false 的语义是「只改该模型的 effort/fast 预设」,绝不能顺手把当前选中模型改掉。
  it('does not change the selected model when the pref is not active', () => {
    const seeded = applyPodDraftPref(null, {
      agent: 'codex',
      modelId: 'gpt-5.6-sol',
      active: true,
    });
    const tweaked = applyPodDraftPref(seeded, {
      agent: 'codex',
      modelId: 'some-other-model',
      active: false,
      effort: 'high',
      fast: true,
    });
    expect(tweaked.lastByVendor.codex?.model).toBe('gpt-5.6-sol');
    // effort/fast 是按 modelId 的全局预设,与是否选中无关,所以这两项要写进去。
    expect(tweaked.effortByModel['some-other-model']).toBe('high');
    expect(tweaked.fastModeByModel['some-other-model']).toBe(true);
  });

  it('keeps other vendors untouched when one vendor changes', () => {
    const both = applyPodDraftPref(
      applyPodDraftPref(null, { agent: 'claude-code', modelId: 'claude-opus-5', active: true }),
      { agent: 'codex', modelId: 'gpt-5.6-sol', active: true },
    );
    expect(both.lastByVendor.cc?.model).toBe('claude-opus-5');
    expect(both.lastByVendor.codex?.model).toBe('gpt-5.6-sol');
  });

  it('ignores a blank model instead of clearing the remembered choice', () => {
    const seeded = applyPodDraftPref(null, {
      agent: 'pi',
      modelId: 'pi-model',
      active: true,
    });
    const blank = applyPodDraftPref(seeded, { agent: 'pi', modelId: '   ', active: true });
    expect(blank.lastByVendor.pi?.model).toBe('pi-model');
  });
});
