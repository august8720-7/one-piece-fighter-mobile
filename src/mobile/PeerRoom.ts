import { Peer, type DataConnection } from 'peerjs';

export type RoomRole = 'host' | 'guest';
export type RoomStatus = 'idle' | 'opening' | 'waiting' | 'connecting' | 'connected' | 'failed';
export interface RoomView { status: RoomStatus; role: RoomRole | null; code: string; message: string }
export interface LinkStats { connectionState: string; roundTripMs: number | null; localType: string | null; remoteType: string | null; protocol: string | null }
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_MESSAGE_CHARS = 8192;

export function normalizeRoomCode(value: string): string | null {
  const code = value.trim().toUpperCase().replace(/[ -]/g, '');
  return /^[A-HJ-NP-Z2-9]{10}$/.test(code) ? code : null;
}

function randomCode(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), value => ALPHABET[value % ALPHABET.length]).join('');
}

/** Shared free signaling only; game packets use an ordered native WebRTC data channel. */
export class PeerRoom {
  private peer: Peer | null = null;
  private connection: DataConnection | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private view: RoomView = { status: 'idle', role: null, code: '', message: '连接同一 Wi-Fi 或手机热点' };
  private readonly states = new Set<(state: RoomView) => void>();
  private readonly packets = new Set<(packet: unknown) => void>();

  get state(): RoomView { return { ...this.view }; }
  onState(listener: (state: RoomView) => void): () => void {
    this.states.add(listener); listener(this.state); return () => this.states.delete(listener);
  }
  onPacket(listener: (packet: unknown) => void): () => void {
    this.packets.add(listener); return () => this.packets.delete(listener);
  }

  host(): string {
    const code = randomCode();
    this.start('host', code);
    return code;
  }
  join(value: string): void {
    const code = normalizeRoomCode(value);
    if (!code) throw new Error('请输入完整的 10 位房间码');
    this.start('guest', code);
  }

  send(packet: unknown): void {
    if (!this.connection?.open || this.view.status !== 'connected') throw new Error('对战连接未就绪');
    const encoded = JSON.stringify(packet);
    if (!encoded || encoded.length > MAX_MESSAGE_CHARS) throw new Error('消息超过对战协议上限');
    if (this.connection.dataChannel.bufferedAmount > 262144) throw new Error('连接发送积压，请重新配对');
    this.connection.send(packet);
  }

  async stats(): Promise<LinkStats | null> {
    const pc = this.connection?.peerConnection;
    if (!pc) return null;
    const rows = await pc.getStats();
    let pair: Record<string, unknown> | undefined;
    rows.forEach(row => {
      if (row.type === 'transport' && row.selectedCandidatePairId) pair = rows.get(row.selectedCandidatePairId);
    });
    if (!pair) rows.forEach(row => { if (row.type === 'candidate-pair' && row.nominated && row.state === 'succeeded') pair = row; });
    const local = pair ? rows.get(String(pair.localCandidateId)) : undefined;
    const remote = pair ? rows.get(String(pair.remoteCandidateId)) : undefined;
    return { connectionState: pc.connectionState,
      roundTripMs: typeof pair?.currentRoundTripTime === 'number' ? pair.currentRoundTripTime * 1000 : null,
      localType: local?.candidateType ?? null, remoteType: remote?.candidateType ?? null, protocol: local?.protocol ?? null };
  }

  close(): void {
    const connection = this.connection, peer = this.peer;
    this.connection = null; this.peer = null; this.clearTimer();
    connection?.close(); peer?.destroy();
    this.view = { status: 'idle', role: null, code: '', message: '连接已结束，可重新配对' };
    this.emit();
  }

  private start(role: RoomRole, code: string): void {
    this.close();
    this.view = { status: 'opening', role, code, message: '正在连接免费配对服务…' }; this.emit();
    if (typeof RTCPeerConnection === 'undefined') { this.fail('此浏览器不支持 WebRTC，请使用新版 Chrome 或 Safari'); return; }
    const id = role === 'host' ? `opf-m1-${code}` : `opf-m1-guest-${randomCode()}`;
    // PeerJS 1.5.5 otherwise includes public STUN/TURN defaults. Explicitly disable both.
    const peer = new Peer(id, { secure: true, config: { iceServers: [] }, debug: 0 });
    this.peer = peer;
    this.timer = setTimeout(() => { if (this.peer === peer && !this.connection?.open) this.fail('连接超时。确认同一 Wi-Fi/热点，并重试配对'); }, 20000);
    peer.on('open', () => {
      if (this.peer !== peer) return;
      if (role === 'host') { this.clearTimer(); this.set('waiting', '房间已创建，等待另一台手机加入'); }
      else { this.set('connecting', '已找到配对服务，正在连接另一台手机…');
        this.attach(peer.connect(`opf-m1-${code}`, { reliable: true, serialization: 'json', metadata: { protocol: 1 } }), peer); }
    });
    peer.on('connection', connection => {
      if (this.peer !== peer || role !== 'host' || this.connection) { connection.close(); return; }
      this.set('connecting', '另一台手机正在加入…');
      this.timer = setTimeout(() => { if (this.peer === peer && !this.connection?.open) this.fail('同网直连未建立，请检查热点隔离或重新配对'); }, 20000);
      this.attach(connection, peer);
    });
    peer.on('disconnected', () => {
      if (this.peer !== peer) return;
      if (this.connection?.open) this.set('connected', '已直连；配对服务暂时离线，对局通道仍可用');
      else this.fail('配对服务已断开，请重新创建或加入房间');
    });
    peer.on('error', error => {
      if (this.peer !== peer) return;
      if (this.connection?.open && ['network', 'server-error', 'socket-error', 'socket-closed'].includes(error.type)) {
        this.set('connected', '配对服务暂时异常，对局直连通道仍可用'); return;
      }
      const detail = error.type === 'peer-unavailable' ? '没有找到这个房间，请核对房间码'
        : error.type === 'unavailable-id' ? '房间码暂时被占用，请重新创建' : '连接失败，请检查网络并重新配对';
      this.fail(detail);
    });
  }

  private attach(connection: DataConnection, peer: Peer): void {
    this.connection = connection;
    connection.on('open', () => {
      if (this.peer !== peer || this.connection !== connection) return;
      this.clearTimer(); this.set('connected', '两台设备已直连');
    });
    connection.on('data', packet => {
      if (this.peer !== peer || this.connection !== connection) return;
      let length = MAX_MESSAGE_CHARS + 1;
      try { length = JSON.stringify(packet)?.length ?? length; } catch { /* Invalid payload remains over limit. */ }
      if (length > MAX_MESSAGE_CHARS) { this.fail('收到超出协议限制的数据，连接已停止'); return; }
      for (const listener of this.packets) listener(packet);
    });
    connection.on('close', () => { if (this.connection === connection) this.fail('对方已断开。本局停止，请重新配对开局'); });
    connection.on('error', () => { if (this.connection === connection) this.fail('对战通道发生错误，请重新配对'); });
  }

  private set(status: RoomStatus, message: string): void { this.view = { ...this.view, status, message }; this.emit(); }
  private fail(message: string): void {
    const role = this.view.role, code = this.view.code;
    this.close(); this.view = { status: 'failed', role, code, message }; this.emit();
  }
  private clearTimer(): void { if (this.timer !== null) clearTimeout(this.timer); this.timer = null; }
  private emit(): void { for (const listener of this.states) listener(this.state); }
}
