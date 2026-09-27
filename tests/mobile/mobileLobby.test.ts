import { describe, expect, it } from 'vitest';
import { characters } from '../../src/characters';
import {
  MOBILE_LOBBY_MODES,
  MOBILE_LOBBY_SCREENS,
  ROOM_CODE_PATTERN,
  mobileCharacterCards,
  lobbyErrorCopy,
  normalizeRoomCode,
} from '../../src/mobile/MobileLobby';

describe('MobileLobby pure contract', () => {
  it('提供完整单机、训练、创建和加入流程以及全部遮罩状态', () => {
    expect(MOBILE_LOBBY_MODES).toEqual(['cpu', 'training', 'host', 'join']);
    expect(MOBILE_LOBBY_SCREENS).toEqual(['home', 'select', 'room', 'hidden', 'pause', 'result', 'error']);
  });

  it('房间码只保留大写字母数字并严格限制十位', () => {
    expect(normalizeRoomCode(' ab-12 cd_34 ef ')).toBe('AB12CD34EF');
    expect(ROOM_CODE_PATTERN.test(normalizeRoomCode(' ab-12 cd_34 ef '))).toBe(true);
    expect(ROOM_CODE_PATTERN.test(normalizeRoomCode('short'))).toBe(false);
  });

  it('四张角色卡直接使用真实角色名称、打法和颜色', () => {
    const cards = mobileCharacterCards();
    expect(cards.map(card => card.id)).toEqual(Object.keys(characters));
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      const def = characters[card.id]!;
      expect(card).toMatchObject({ name: def.name, tagline: def.tagline });
      expect(card.color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('单机资源错误与联网错误使用不同操作口径', () => {
    expect(lobbyErrorCopy('cpu')).toEqual({
      title: '暂时无法开始',
      help: '本场角色或舞台资源尚未准备完成，请稍后重试。',
      retry: '重试加载',
    });
    expect(lobbyErrorCopy('training').retry).toBe('重试加载');
    expect(lobbyErrorCopy('host')).toMatchObject({ title: '连接中断', retry: '重试连接' });
    expect(lobbyErrorCopy('join').help).toContain('同一 Wi-Fi 或热点');
  });
});
