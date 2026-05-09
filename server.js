const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const clients = []; // SSE clients

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Serve index.html
  if (req.method === "GET" && req.url === "/") {
    const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  // SSE endpoint - browser subscribes here
  if (req.method === "GET" && req.url === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("data: connected\n\n");

    clients.push(res);
    console.log(`[SSE] Client connected. Total: ${clients.length}`);

    req.on("close", () => {
      const idx = clients.indexOf(res);
      if (idx !== -1) clients.splice(idx, 1);
      console.log(`[SSE] Client disconnected. Total: ${clients.length}`);
    });
    return;
  }

  // SCB Webhook endpoint
  if (req.method === "POST" && req.url === "/webhook/scb") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        console.log("[WEBHOOK] Received:", JSON.stringify(data, null, 2));

        // Parse SCB payload
        const payment = {
          transRef: data.transRef || data.data?.transRef || "N/A",
          amount: data.amount || data.data?.amount || 0,
          sendingBank: data.sendingBank || data.data?.sendingBank || "Unknown",
          receiver: data.receiver || data.data?.receiver || {},
          transDate: data.transDate || data.data?.transDate || "",
          transTime: data.transTime || data.data?.transTime || "",
          billPaymentRef1: data.billPaymentRef1 || data.data?.billPaymentRef1 || "",
          receivedAt: new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }),
        };

        // Broadcast to all SSE clients
        const event = `data: ${JSON.stringify(payment)}\n\n`;
        clients.forEach((client) => client.write(event));
        console.log(`[WEBHOOK] Broadcasted to ${clients.length} clients`);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      } catch (e) {
        console.error("[WEBHOOK] Parse error:", e.message);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  // Test trigger endpoint (simulate SCB webhook)
  if (req.method === "POST" && req.url === "/test") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const params = JSON.parse(body || "{}");
      const amount = params.amount || (Math.random() * 990 + 10).toFixed(2);
      const banks = ["SCB", "KBANK", "BBL", "KTB", "TTB", "BAY"];
      const mockPayload = {
        transRef: "SCB" + Date.now(),
        amount: parseFloat(amount),
        sendingBank: banks[Math.floor(Math.random() * banks.length)],
        receiver: { accountNumber: "xxx-x-xxxxx-x", accountName: "ร้านของฉัน" },
        transDate: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
        transTime: new Date().toTimeString().slice(0, 8).replace(/:/g, ""),
        billPaymentRef1: params.ref || "",
        receivedAt: new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }),
      };

      const event = `data: ${JSON.stringify(mockPayload)}\n\n`;
      clients.forEach((client) => client.write(event));

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", sent: mockPayload }));
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  💳 SCB Payment Notify Server`);
  console.log(`  🌐 เปิดเว็บ: http://localhost:${PORT}`);
  console.log(`  🔗 Webhook URL: http://localhost:${PORT}/webhook/scb`);
  console.log(`  🧪 ทดสอบ: POST http://localhost:${PORT}/test`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
});
