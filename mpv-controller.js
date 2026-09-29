/**
 * ZephyrPlayer – mpv controller
 * Uses mpv JSON IPC for full control when mpv.exe is available.
 * This gives full codec support, hwdec, high-quality scaling, subtitles, tracks, etc.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { EventEmitter } = require('events');

class MpvController extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.socket = null;
    this.requestId = 1;
    this.pending = new Map();
    this.mpvPath = null;
    this.ipcPath = null;
    this.ready = false;
    this.quality = 'high';
  }

  findMpv() {
    const candidates = [
      path.join(process.resourcesPath || __dirname, 'mpv.exe'),
      path.join(__dirname, 'mpv.exe'),
      path.join(__dirname, 'mpv', 'mpv.exe'),
      path.join(path.dirname(process.execPath), 'mpv.exe')
    ];
    for (const p of candidates) {
      try { if (fs.existsSync(p)) return p; } catch {}
    }
    // PATH
    try {
      const { execSync } = require('child_process');
      if (process.platform === 'win32') {
        execSync('where mpv', { stdio: 'ignore' });
        return 'mpv';
      }
      execSync('which mpv', { stdio: 'ignore' });
      return 'mpv';
    } catch {}
    return null;
  }

  getQualityArgs(quality) {
    const q = quality || this.quality || 'high';
    const args = [
      '--hwdec=auto-safe',
      '--vo=gpu',
      '--gpu-api=d3d11',
      '--gpu-context=d3d11',
      '--keep-open=yes',
      '--force-window=yes',
      '--input-ipc-server=' + this.ipcPath,
      '--idle=yes',
      '--no-terminal',
      '--msg-level=all=error'
    ];

    if (q === 'high' || q === 'sharpen' || q === 'anime') {
      args.push(
        '--scale=ewa_lanczossharp',
        '--cscale=ewa_lanczossharp',
        '--dscale=mitchell',
        '--correct-downscaling=yes',
        '--linear-downscaling=yes',
        '--sigmoid-upscaling=yes',
        '--sharpen=0.4'
      );
    }
    if (q === 'anime' || q === 'high') {
      args.push(
        '--deband=yes',
        '--deband-iterations=2',
        '--deband-threshold=64',
        '--deband-range=16',
        '--deband-grain=4'
      );
    }
    if (q === 'fast') {
      args.push('--scale=bilinear', '--cscale=bilinear', '--profile=fast');
    }
    return args;
  }

  async start(quality = 'high') {
    this.mpvPath = this.findMpv();
    if (!this.mpvPath) {
      this.emit('error', new Error('mpv not found'));
      return false;
    }

    this.quality = quality;
    // Unique pipe name on Windows
    const id = Date.now().toString(36);
    this.ipcPath = process.platform === 'win32'
      ? `\\\\.\\pipe\\zephyr-mpv-${id}`
      : `/tmp/zephyr-mpv-${id}.sock`;

    if (this.process) {
      try { this.process.kill(); } catch {}
      this.process = null;
    }

    const args = this.getQualityArgs(quality);
    this.process = spawn(this.mpvPath, args, {
      stdio: 'ignore',
      windowsHide: false,
      detached: false
    });

    this.process.on('exit', (code) => {
      this.ready = false;
      this.process = null;
      this.socket = null;
      this.emit('exit', code);
    });

    this.process.on('error', (err) => {
      this.emit('error', err);
    });

    // Wait a moment then connect IPC
    await new Promise(r => setTimeout(r, 400));
    return this.connectIpc();
  }

  connectIpc() {
    return new Promise((resolve) => {
      if (process.platform === 'win32') {
        // Named pipe
        this.socket = net.connect(this.ipcPath, () => {
          this.ready = true;
          this.emit('ready');
          resolve(true);
        });
      } else {
        this.socket = net.createConnection(this.ipcPath, () => {
          this.ready = true;
          this.emit('ready');
          resolve(true);
        });
      }

      this.socket.on('data', (data) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const msg = JSON.parse(line);
            if (msg.request_id != null && this.pending.has(msg.request_id)) {
              const { resolve, reject } = this.pending.get(msg.request_id);
              this.pending.delete(msg.request_id);
              if (msg.error) reject(new Error(msg.error));
              else resolve(msg);
            } else if (msg.event) {
              this.emit('event', msg);
              if (msg.event === 'property-change') {
                this.emit('property', msg.name, msg.data);
              }
            }
          } catch {}
        }
      });

      this.socket.on('error', (err) => {
        this.ready = false;
        this.emit('error', err);
        resolve(false);
      });

      this.socket.on('close', () => {
        this.ready = false;
      });

      // Timeout
      setTimeout(() => {
        if (!this.ready) resolve(false);
      }, 2000);
    });
  }

  command(cmd, args = []) {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.ready) {
        reject(new Error('mpv not ready'));
        return;
      }
      const id = this.requestId++;
      const payload = { command: [cmd, ...args], request_id: id };
      this.pending.set(id, { resolve, reject });
      this.socket.write(JSON.stringify(payload) + '\n');
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('timeout'));
        }
      }, 5000);
    });
  }

  async load(file) {
    return this.command('loadfile', [file, 'replace']);
  }

  async play() { return this.command('set_property', ['pause', false]); }
  async pause() { return this.command('set_property', ['pause', true]); }
  async togglePause() { return this.command('cycle', ['pause']); }
  async stop() { return this.command('stop'); }

  async seek(seconds, mode = 'absolute') {
    return this.command('seek', [seconds, mode]);
  }

  async setVolume(v) {
    return this.command('set_property', ['volume', Math.max(0, Math.min(150, v))]);
  }

  async setSpeed(rate) {
    return this.command('set_property', ['speed', rate]);
  }

  async setProperty(name, value) {
    return this.command('set_property', [name, value]);
  }

  async getProperty(name) {
    const res = await this.command('get_property', [name]);
    return res && res.data;
  }

  async observe(name) {
    return this.command('observe_property', [this.requestId++, name]);
  }

  async quit() {
    try { await this.command('quit'); } catch {}
    if (this.process) {
      try { this.process.kill(); } catch {}
      this.process = null;
    }
    this.ready = false;
  }

  isAvailable() {
    return !!this.findMpv();
  }

  isReady() {
    return this.ready;
  }
}

module.exports = { MpvController, findMpv: () => new MpvController().findMpv() };

