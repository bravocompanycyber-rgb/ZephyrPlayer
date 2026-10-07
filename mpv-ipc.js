'use strict';
/**
 * Minimal, defensive client for mpv's JSON IPC (--input-ipc-server).
 * Never throws from event callbacks; every command is a Promise with a timeout.
 */
const net = require('net');
const { EventEmitter } = require('events');

class MpvIpc extends EventEmitter {
  constructor() {
    super();
    this.sock = null;
    this.buf = '';
    this.seq = 1;
    this.obsId = 1;
    this.pending = new Map();
    this.connected = false;
    this.destroyed = false;
    this.props = Object.create(null);
  }

  connect(pipePath, { attempts = 60, delayMs = 100 } = {}) {
    return new Promise((resolve, reject) => {
      let tries = 0;
      const attempt = () => {
        if (this.destroyed) return reject(new Error('destroyed'));
        const s = net.connect(pipePath);
        let opened = false;
        s.once('connect', () => { opened = true; this._attach(s); resolve(); });
        s.once('error', (err) => {
          if (opened) return;
          try { s.destroy(); } catch {}
          if (++tries >= attempts) reject(err);
          else setTimeout(attempt, delayMs);
        });
      };
      attempt();
    });
  }

  _attach(sock) {
    this.sock = sock;
    this.connected = true;
    sock.setEncoding('utf8');
    sock.on('data', (chunk) => this._onData(chunk));
    sock.on('error', () => {});
    sock.on('close', () => {
      const wasConnected = this.connected;
      this.connected = false;
      for (const [, p] of this.pending) { clearTimeout(p.t); p.reject(new Error('mpv connection closed')); }
      this.pending.clear();
      if (wasConnected) this.emit('close');
    });
    this.emit('connect');
  }

  _onData(chunk) {
    this.buf += chunk;
    if (this.buf.length > 8 * 1024 * 1024) this.buf = ''; // runaway guard
    let idx;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      try { this._dispatch(msg); } catch {}
    }
  }

  _dispatch(msg) {
    if (msg.request_id !== undefined && this.pending.has(msg.request_id)) {
      const p = this.pending.get(msg.request_id);
      this.pending.delete(msg.request_id);
      clearTimeout(p.t);
      if (msg.error === 'success') p.resolve(msg.data);
      else p.reject(new Error(String(msg.error || 'mpv error')));
      return;
    }
    if (msg.event === 'property-change') {
      this.props[msg.name] = msg.data;
      this.emit('prop', msg.name, msg.data);
      return;
    }
    if (msg.event) this.emit('mpv-event', msg);
  }

  command(...args) { return this.commandT(6000, ...args); }

  commandT(timeoutMs, ...args) {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.sock) return reject(new Error('mpv not connected'));
      const id = this.seq++;
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('mpv command timeout: ' + String(args[0])));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, t });
      try {
        this.sock.write(JSON.stringify({ command: args, request_id: id }) + '\n');
      } catch (e) {
        clearTimeout(t);
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  set(name, value) { return this.command('set_property', name, value); }
  get(name) { return this.command('get_property', name); }
  observe(name) { return this.command('observe_property', this.obsId++, name); }

  destroy() {
    this.destroyed = true;
    this.connected = false;
    for (const [, p] of this.pending) { clearTimeout(p.t); p.reject(new Error('destroyed')); }
    this.pending.clear();
    try { if (this.sock) this.sock.destroy(); } catch {}
    this.sock = null;
    this.removeAllListeners();
  }
}

module.exports = { MpvIpc };
