const DASHBOARD_SETUP_KEY = Symbol.for("brightsmile.dashboard.setup");

function createRateCounter() {
	let total = 0;
	let windowStart = Date.now();
	let windowCount = 0;
	let fps = 0;

	function refresh(now) {
		const elapsed = now - windowStart;
		if (elapsed < 1000) return;
		fps = elapsed > 0 ? (windowCount * 1000) / elapsed : 0;
		windowStart = now;
		windowCount = 0;
	}

	return {
		tick(now = Date.now()) {
			total += 1;
			windowCount += 1;
			refresh(now);
		},
		snapshot(now = Date.now()) {
			refresh(now);
			return {
				total,
				fps: Number(fps.toFixed(2)),
			};
		},
	};
}

function createLatencyCounter() {
	let windowStart = Date.now();
	let windowCount = 0;
	let windowSum = 0;
	let averageMs = 0;
	let latestMs = null;

	function refresh(now) {
		const elapsed = now - windowStart;
		if (elapsed < 1000) return;
		averageMs = windowCount > 0 ? windowSum / windowCount : averageMs;
		windowStart = now;
		windowCount = 0;
		windowSum = 0;
	}

	return {
		tick(latencyMs, now = Date.now()) {
			if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
			latestMs = latencyMs;
			windowCount += 1;
			windowSum += latencyMs;
			refresh(now);
		},
		snapshot(now = Date.now()) {
			refresh(now);
			return {
				latestMs: latestMs == null ? null : Number(latestMs.toFixed(2)),
				averageMs: Number(averageMs.toFixed(2)),
			};
		},
	};
}

function setupDashboard(io, {
	ingestBus,
	videoBus,
	options = {},
	params = {},
	statusProviders = {},
} = {}) {
	if (!io) throw new Error("[dashboard] io is required");
	if (io[DASHBOARD_SETUP_KEY]) return io[DASHBOARD_SETUP_KEY];

	const defaultIntervalMs = options.defaultIntervalMs;
	const moduleAliveMs = options.moduleAliveMs ?? 3000;
	const startedAt = Date.now();
	let subscriberCount = 0;

	const ingestRate = createRateCounter();
	const videoRate = createRateCounter();
	const latency = createLatencyCounter();

	let ingestLastFrameId = null;
	let ingestLastTsSrc = null;
	let videoLastTsSrc = null;
	let ingestLastSeenAt = null;
	let videoLastSeenAt = null;

	ingestBus.on("frame", (pkt) => {
		const now = Date.now();
		ingestRate.tick(now);
		ingestLastSeenAt = now;
		ingestLastFrameId = pkt.frameId;
		ingestLastTsSrc = pkt.ts_src;
	});

	videoBus.on("frame", (frame) => {
		const now = Date.now();
		videoRate.tick(now);
		videoLastSeenAt = now;
		videoLastTsSrc = frame.ts_src;
		latency.tick(now - frame.ts_src, now);
	});

	function connectedClients() {
		return io.engine.clientsCount;
	}

	function buildSnapshot() {
		const now = Date.now();
		const mem = process.memoryUsage();
		const ingest = ingestRate.snapshot(now);
		const video = videoRate.snapshot(now);
		const latencySnapshot = latency.snapshot(now);
		const modules = {
			ingestBus: {
				alive: Boolean(ingestLastSeenAt && now - ingestLastSeenAt <= moduleAliveMs),
				lastSeenAt: ingestLastSeenAt,
			},
			videoBus: {
				alive: Boolean(videoLastSeenAt && now - videoLastSeenAt <= moduleAliveMs),
				lastSeenAt: videoLastSeenAt,
			},
			dashboard: {
				alive: true,
				defaultIntervalMs,
			},
		};

		for (const [name, provider] of Object.entries(statusProviders)) {
			modules[name] = provider();
		}

		const processInfo = {
			uptimeSec: Number(process.uptime().toFixed(1)),
			memory: {
				rss: mem.rss,
				heapTotal: mem.heapTotal,
				heapUsed: mem.heapUsed,
				external: mem.external,
			},
		};

		return {
			type: "dashboard:update",
			ts: now,
			uptimeMs: now - startedAt,
			process: processInfo,
			server: {
				connectedClients: connectedClients(),
			},
			ingest: {
				fps: ingest.fps,
				totalFrames: ingest.total,
				lastFrameId: ingestLastFrameId,
				lastTsSrc: ingestLastTsSrc,
			},
			video: {
				fps: video.fps,
				totalFrames: video.total,
				lastTsSrc: videoLastTsSrc,
				latencyMs: latencySnapshot,
			},
			modules,
		};
	}

	function buildConfigSnapshot() {
		return {
			type: "dashboard:config",
			ts: Date.now(),
			config: params,
		};
	}

	io.on("connection", (socket) => {
		let pushTimer = null;

		function stopPush() {
			if (!pushTimer) return;
			clearInterval(pushTimer);
			pushTimer = null;
			subscriberCount = Math.max(0, subscriberCount - 1);
		}

		function pushNow() {
			socket.emit("dashboard:update", buildSnapshot());
		}

		function pushConfig() {
			socket.emit("dashboard:config", buildConfigSnapshot());
		}

		function startPush(intervalMs) {
			const pushIntervalMs = intervalMs ?? defaultIntervalMs;
			if (pushTimer) {
				clearInterval(pushTimer);
			} else {
				subscriberCount += 1;
			}
			pushTimer = setInterval(pushNow, pushIntervalMs);

			socket.emit("dashboard:subscribed", {
				intervalMs: pushIntervalMs,
			});

			pushConfig();
			pushNow();
		}

		socket.on("dashboard:request", (payload = {}) => {
			pushNow();
			if (payload.withConfig === true) {
				pushConfig();
			}
			if (payload.subscribe === true) {
				startPush(payload.intervalMs);
			}
		});

		socket.on("dashboard:subscribe", (payload = {}) => {
			startPush(payload.intervalMs);
		});

		socket.on("dashboard:config:request", () => {
			pushConfig();
		});

		socket.on("dashboard:unsubscribe", () => {
			stopPush();
			socket.emit("dashboard:unsubscribed");
		});

		socket.on("disconnect", () => {
			stopPush();
		});
	});

	const api = {
		buildSnapshot,
		buildConfigSnapshot,
		getStatus() {
			return {
				alive: true,
				startedAt,
				defaultIntervalMs,
				subscriberCount,
			};
		},
	};

	io[DASHBOARD_SETUP_KEY] = api;
	return api;
}

module.exports = setupDashboard;
