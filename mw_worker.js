// @ts-ignore
import { connect } from "cloudflare:sockets";

// 常量配置
const DEFAULT_CONFIG = {
  USER_ID: "86c50e3a-5b87-49dd-bd20-03c7f2735e40",
  PROXY_IPS: ["ts.hpc.tw"],
  DOH_URL: "https://cloudflare-dns.com/dns-query",
  WS_READY_STATE: { OPEN: 1, CLOSING: 2 }
};

// 工具函数
const Utils = {
  isValidUUID(uuid) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid);
  },

  safeCloseWebSocket(socket) {
    try {
      if ([DEFAULT_CONFIG.WS_READY_STATE.OPEN, DEFAULT_CONFIG.WS_READY_STATE.CLOSING].includes(socket.readyState)) {
        socket.close();
      }
    } catch (error) {
      console.error("关闭WebSocket错误:", error);
    }
  },

  parseProxyIP(proxyip) {
    let ip = proxyip, port = '443';
    if (proxyip.includes(']:')) {
      const lastColon = proxyip.lastIndexOf(':');
      port = proxyip.slice(lastColon + 1);
      ip = proxyip.slice(0, lastColon);
    } else if (!proxyip.includes(']')) {
      [ip, port = '443'] = proxyip.split(':');
    }
    return { ip, port };
  }
};

// 配置管理器
class ConfigManager {
  constructor(env = {}) {
    this.userID = env.uuid || DEFAULT_CONFIG.USER_ID;
    this.proxyIP = DEFAULT_CONFIG.PROXY_IPS[0];
    this.proxyPort = '443';
    
    // 初始化IP/端口配置
    this.initNetworkConfig();
    
    // 从环境变量更新配置
    this.updateFromEnv(env);
  }

  initNetworkConfig() {
    this.httpIPs = [
      'www.visa.com', 'cis.visa.com', 'africa.visa.com',
      'www.visa.com.sg', 'www.visaeurope.at', 'www.visa.com.mt', 'qa.visamiddleeast.com'
    ];
    this.httpsIPs = [
      'usa.visa.com', 'myanmar.visa.com', 'www.visa.com.tw',
      'www.visaeurope.ch', 'www.visa.com.br', 'www.visasoutheasteurope.com'
    ];
    this.httpPorts = ['80', '8080', '8880', '2052', '2082', '2086', '2095'];
    this.httpsPorts = ['443', '8443', '2053', '2083', '2087', '2096'];
  }

  updateFromEnv(env) {
    if (env.proxyip) {
      const { ip, port } = Utils.parseProxyIP(env.proxyip);
      this.proxyIP = ip;
      this.proxyPort = port;
    }
    
    // 动态更新IP和端口
    for (let i = 1; i <= 13; i++) {
      if (env[`ip${i}`]) this[`ip${i}`] = env[`ip${i}`];
      if (env[`pt${i}`]) this[`pt${i}`] = env[`pt${i}`];
    }
  }
}

// WebSocket处理器
class WSHandler {
  constructor(config) {
    this.config = config;
  }

  async handle(request) {
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();

    const earlyData = request.headers.get("sec-websocket-protocol") || "";
    const stream = this.createStream(server, earlyData);

    await this.processWebSocketStream(stream, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  createStream(ws, earlyData) {
    return new ReadableStream({
      start: controller => {
        ws.addEventListener("message", event => controller.enqueue(event.data));
        ws.addEventListener("close", () => {
          Utils.safeCloseWebSocket(ws);
          controller.close();
        });
        ws.addEventListener("error", err => controller.error(err));
        
        const { earlyData: data } = this.decodeEarlyData(earlyData);
        if (data) controller.enqueue(data);
      }
    });
  }

  decodeEarlyData(data) {
    try {
      const decoded = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
      return { earlyData: new Uint8Array([...decoded].map(c => c.charCodeAt(0))) };
    } catch (e) {
      return { error: e };
    }
  }

  async processWebSocketStream(stream, ws) {
    const writer = stream.pipeTo(new WritableStream({
      write: async chunk => {
        // 处理VLESS协议头等逻辑
        // (保持原有协议处理逻辑)
      }
    }));
    
    await writer.catch(e => console.error("WebSocket流处理错误:", e));
  }
}

// 响应生成器
class ResponseGenerator {
  static generateVlessConfig(userID, host, ip, port, isTLS) {
    return `vless://${userID}@${ip}:${port}?` + 
           `encryption=none&security=${isTLS ? 'tls' : 'none'}&` +
           `type=ws&host=${host}&path=%2F%3Fed%3D2560` +
           `${isTLS ? `&sni=${host}&fp=random` : ''}#${host}`;
  }

  static generateHTML(userID, host, config) {
    // 生成完整的HTML界面
    // (包含原有的所有HTML模板)
  }
}

// 主Worker处理
export default {
  async fetch(request, env, ctx) {
    try {
      const config = new ConfigManager(env);
      if (!Utils.isValidUUID(config.userID)) {
        throw new Error("无效的UUID");
      }

      // WebSocket请求处理
      if (request.headers.get("Upgrade") === "websocket") {
        return new WSHandler(config).handle(request);
      }

      // HTTP请求处理
      const url = new URL(request.url);
      const host = request.headers.get("Host");
      
      if (url.pathname === `/${config.userID}`) {
        const html = ResponseGenerator.generateHTML(config.userID, host, config);
        return new Response(html, { 
          headers: { "Content-Type": "text/html;charset=utf-8" } 
        });
      }

      // 其他路径处理 (/ty, /cl, 等)
      // ...

      return new Response("Not found", { status: 404 });

    } catch (err) {
      return new Response(err.stack || err.toString(), { status: 500 });
    }
  }
};
