// A small obs-websocket (v5, OBS 28+) client. The control panel uses it to
// switch OBS scenes at the moment a wipe covers the screen. It connects from
// this browser straight to OBS on this computer (or another one on the same
// network), so nothing about OBS goes through the studio server.
//
// In OBS: Tools → WebSocket Server Settings → Enable WebSocket server.

const SCENE_EVENTS = 1 << 2; // EventSubscription.Scenes

export async function obsAuth(password, salt, challenge) {
  const hash = async text => {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
    let binary = '';
    bytes.forEach(b => { binary += String.fromCharCode(b); });
    return btoa(binary);
  };
  return hash(await hash(password + salt) + challenge);
}

export class ObsLink {
  constructor(onChange = () => {}) {
    this.onChange = onChange;
    this.socket = null;
    this.state = 'off';        // off | connecting | on | error
    this.error = '';
    this.scenes = [];          // scene names, top of the OBS list first
    this.current = '';
    this.pending = new Map();
    this.next = 1;
  }

  setState(state, error = '') {
    this.state = state;
    this.error = error;
    this.onChange(this);
  }

  connect(url, password = '') {
    this.close();
    return new Promise((resolve, reject) => {
      let socket;
      try { socket = new WebSocket(url); } catch (error) { this.setState('error', 'That address is not a WebSocket URL (ws://…).'); reject(error); return; }
      this.socket = socket;
      this.setState('connecting');
      let identified = false;
      const timer = setTimeout(() => { if (!identified) { socket.close(); this.setState('error', 'OBS did not answer. Is the WebSocket server on?'); reject(new Error('timeout')); } }, 6000);
      socket.onmessage = async event => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        const {op, d} = message;
        if (op === 0) { // Hello
          const identify = {rpcVersion: 1, eventSubscriptions: SCENE_EVENTS};
          if (d.authentication) {
            if (!password) { socket.close(4009); return; }
            identify.authentication = await obsAuth(password, d.authentication.salt, d.authentication.challenge);
          }
          socket.send(JSON.stringify({op: 1, d: identify}));
        } else if (op === 2) { // Identified
          identified = true;
          clearTimeout(timer);
          this.setState('on');
          try { await this.refresh(); } catch {}
          resolve(this);
        } else if (op === 7) { // RequestResponse
          const waiting = this.pending.get(d.requestId);
          if (!waiting) return;
          this.pending.delete(d.requestId);
          if (d.requestStatus?.result) waiting.resolve(d.responseData || {});
          else waiting.reject(new Error(d.requestStatus?.comment || 'OBS refused that.'));
        } else if (op === 5) { // Event
          if (d.eventType === 'CurrentProgramSceneChanged') { this.current = d.eventData.sceneName; this.onChange(this); }
          if (d.eventType === 'SceneListChanged' || d.eventType === 'SceneNameChanged' || d.eventType === 'SceneCreated' || d.eventType === 'SceneRemoved') {
            this.refresh().catch(() => {});
          }
        }
      };
      socket.onclose = event => {
        clearTimeout(timer);
        this.pending.forEach(waiting => waiting.reject(new Error('OBS disconnected.')));
        this.pending.clear();
        if (this.socket !== socket) return;
        this.socket = null;
        this.scenes = [];
        const message = event.code === 4009 ? 'OBS needs the WebSocket password.' :
          event.code === 4008 ? 'Wrong OBS WebSocket password.' : identified ? 'OBS disconnected.' : 'Could not reach OBS at that address.';
        this.setState(identified && event.code === 1000 ? 'off' : 'error', message);
        if (!identified) reject(new Error(message));
      };
    });
  }

  close() {
    const socket = this.socket;
    this.socket = null;
    this.scenes = [];
    if (socket) socket.close(1000);
    if (this.state !== 'off') this.setState('off');
  }

  request(requestType, requestData) {
    if (!this.socket || this.state !== 'on') return Promise.reject(new Error('OBS is not connected.'));
    const requestId = String(this.next++);
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, {resolve, reject});
      this.socket.send(JSON.stringify({op: 6, d: {requestType, requestId, ...(requestData ? {requestData} : {})}}));
      setTimeout(() => { if (this.pending.delete(requestId)) reject(new Error('OBS did not answer.')); }, 5000);
    });
  }

  async refresh() {
    const list = await this.request('GetSceneList');
    // OBS lists scenes bottom-first; show them in the order the Scenes dock does.
    this.scenes = (list.scenes || []).slice().sort((a, b) => b.sceneIndex - a.sceneIndex).map(s => s.sceneName);
    this.current = list.currentProgramSceneName || '';
    this.onChange(this);
  }

  setScene(sceneName) {
    return this.request('SetCurrentProgramScene', {sceneName});
  }
}
