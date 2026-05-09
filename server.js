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

  // OAuth callback endpoint (for SCB URL validation + future OAuth flow)
  if (req.method === "GET" && req.url.startsWith("/callback")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h1>OAuth Callback OK</h1>");
    return;
  }

  // Allow GET on /webhook/scb and /notify so SCB URL validation passes
  if (req.method === "GET" && (req.url === "/webhook/scb" || req.url === "/notify")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", message: "Endpoint is alive" }));
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

  // SCB Webhook endpoint (accept both /webhook/scb and /notify)
  if (req.method === "POST" && (req.url === "/webhook/scb" || req.url === "/notify")) {
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

  // EasySlip verify endpoint
  if (req.method === "POST" && req.url === "/verify") {
    const apiKey = process.env.EASYSLIP_API_KEY;
    if (!apiKey) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: "EASYSLIP_API_KEY not configured" }));
      return;
    }

    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const input = JSON.parse(body || "{}");
        let easyslipRes;

        if (input.payload) {
          // QR payload string -> JSON request
          easyslipRes = await fetch("https://api.easyslip.com/v2/verify/bank", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ payload: input.payload, checkDuplicate: true }),
          });
        } else if (input.imageBase64) {
          // base64 image -> multipart upload
          const base64 = input.imageBase64.replace(/^data:image\/\w+;base64,/, "");
          const buffer = Buffer.from(base64, "base64");
          const form = new FormData();
          form.append("image", new Blob([buffer]), "slip.jpg");
          form.append("checkDuplicate", "true");

          easyslipRes = await fetch("https://api.easyslip.com/v2/verify/bank", {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiKey}` },
            body: form,
          });
        } else {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: false, error: "Provide imageBase64 or payload" }));
          return;
        }

        const result = await easyslipRes.json();
        console.log("[VERIFY] EasySlip response:", JSON.stringify(result));

        if (!result.success) {
          res.writeHead(easyslipRes.status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
          return;
        }

        // Map EasySlip response -> our payment shape
        const slip = result.data?.rawSlip || {};
        const payment = {
          transRef: slip.transRef || "N/A",
          amount: slip.amount?.amount || 0,
          sendingBank: slip.sender?.bank?.short || slip.sender?.bank?.name || "Unknown",
          senderName: slip.sender?.account?.name?.th || slip.sender?.account?.name?.en || "",
          receiver: {
            bank: slip.receiver?.bank?.short || "",
            accountName: slip.receiver?.account?.name?.th || slip.receiver?.account?.name?.en || "",
          },
          transDate: slip.date || "",
          isDuplicate: result.data?.isDuplicate || false,
          receivedAt: new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }),
        };

        // Broadcast to SSE only if not duplicate
        if (!payment.isDuplicate) {
          const event = `data: ${JSON.stringify(payment)}\n\n`;
          clients.forEach((client) => client.write(event));
          console.log(`[VERIFY] Broadcasted to ${clients.length} clients`);
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, data: payment, duplicate: payment.isDuplicate }));
      } catch (e) {
        console.error("[VERIFY] Error:", e);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: e.message }));
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
