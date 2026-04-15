"use client";

import { useEffect, useMemo, useState } from "react";
import type { Store } from "@/lib/types";
import { STAMP_RADIUS_M } from "@/lib/geo";

type Props = {
  userLat: number;
  userLng: number;
  stores: Store[];
  visitedIds: Set<string>;
};

const SCALES = [
  { label: "500m", meters: 500 },
  { label: "1km", meters: 1000 },
  { label: "2km", meters: 2000 },
  { label: "5km", meters: 5000 },
  { label: "10km", meters: 10000 },
];

const SVG_SIZE = 280;
const RADIUS = 130; // SVGの最大半径
const CENTER = SVG_SIZE / 2;

export function Radar({ userLat, userLng, stores, visitedIds }: Props) {
  const [scaleIdx, setScaleIdx] = useState(1);
  const [heading, setHeading] = useState<number | null>(null); // 北=0, 時計回り
  const [orientationEnabled, setOrientationEnabled] = useState(false);
  const [orientationError, setOrientationError] = useState<string | null>(null);

  const scale = SCALES[scaleIdx];

  // デバイス方位（iOS は許可必須）
  useEffect(() => {
    if (!orientationEnabled) return;
    const onOrient = (e: DeviceOrientationEvent) => {
      const ev = e as DeviceOrientationEvent & { webkitCompassHeading?: number };
      // iOS Safari は webkitCompassHeading（北=0、時計回り、真北補正済み）
      // それ以外は alpha（北=0、反時計回り）
      const h =
        typeof ev.webkitCompassHeading === "number"
          ? ev.webkitCompassHeading
          : ev.alpha != null
            ? 360 - ev.alpha
            : null;
      if (h != null) setHeading(h);
    };
    window.addEventListener("deviceorientation", onOrient, true);
    return () => window.removeEventListener("deviceorientation", onOrient, true);
  }, [orientationEnabled]);

  const requestOrientation = async () => {
    setOrientationError(null);
    type RequestablePermission = {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    const cls = (
      typeof DeviceOrientationEvent !== "undefined"
        ? (DeviceOrientationEvent as unknown as RequestablePermission)
        : null
    );
    try {
      if (cls?.requestPermission) {
        const r = await cls.requestPermission();
        if (r !== "granted") {
          setOrientationError("方位センサーの利用が許可されませんでした");
          return;
        }
      }
      setOrientationEnabled(true);
    } catch (e) {
      setOrientationError(e instanceof Error ? e.message : String(e));
    }
  };

  // 店舗をレーダー座標へ
  const dots = useMemo(() => {
    const mPerLat = 111_320;
    const mPerLng = 111_320 * Math.cos((userLat * Math.PI) / 180);
    const headingRad = ((heading ?? 0) * Math.PI) / 180;
    const cosH = Math.cos(headingRad);
    const sinH = Math.sin(headingRad);
    return stores
      .map((s) => {
        const dx = (s.lng - userLng) * mPerLng;
        const dy = (s.lat - userLat) * mPerLat; // 北が正
        const dist = Math.hypot(dx, dy);
        // ヘディング分回転（向いてる方向が上）
        const rx = dx * cosH - dy * sinH;
        const ry = dx * sinH + dy * cosH;
        const ratio = dist / scale.meters;
        return {
          store: s,
          dist,
          // SVG: 右が +x, 下が +y。北を上に出すため ry を反転
          x: CENTER + (rx / scale.meters) * RADIUS,
          y: CENTER - (ry / scale.meters) * RADIUS,
          ratio,
          visited: visitedIds.has(s.id),
        };
      })
      .filter((d) => d.ratio <= 1.05) // ちょっと外まで
      .sort((a, b) => a.dist - b.dist);
  }, [stores, userLat, userLng, heading, scale.meters, visitedIds]);

  const stampRingRatio = STAMP_RADIUS_M / scale.meters;

  return (
    <section>
      <div className="mb-3 flex flex-wrap gap-1">
        {SCALES.map((s, i) => (
          <button
            key={s.label}
            onClick={() => setScaleIdx(i)}
            className={`flex-1 rounded-full px-2 py-1 text-xs font-semibold ${
              i === scaleIdx
                ? "bg-emerald-600 text-white"
                : "bg-gray-100 text-gray-700"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="relative mx-auto aspect-square w-full max-w-[320px] overflow-hidden rounded-full bg-gradient-radial from-emerald-950 via-emerald-900 to-black">
        <svg
          viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
          className="absolute inset-0 h-full w-full"
        >
          {/* スイープ */}
          <defs>
            <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgba(16,185,129,0)" />
              <stop offset="100%" stopColor="rgba(16,185,129,0.55)" />
            </linearGradient>
            <radialGradient id="dot-glow">
              <stop offset="0%" stopColor="rgba(74,222,128,0.9)" />
              <stop offset="100%" stopColor="rgba(74,222,128,0)" />
            </radialGradient>
          </defs>

          {/* 同心円 */}
          {[0.25, 0.5, 0.75, 1].map((r) => (
            <circle
              key={r}
              cx={CENTER}
              cy={CENTER}
              r={RADIUS * r}
              fill="none"
              stroke="rgba(74,222,128,0.25)"
              strokeWidth="1"
            />
          ))}
          {/* 十字 */}
          <line
            x1={CENTER - RADIUS}
            y1={CENTER}
            x2={CENTER + RADIUS}
            y2={CENTER}
            stroke="rgba(74,222,128,0.18)"
          />
          <line
            x1={CENTER}
            y1={CENTER - RADIUS}
            x2={CENTER}
            y2={CENTER + RADIUS}
            stroke="rgba(74,222,128,0.18)"
          />

          {/* 100m スタンプ圏 */}
          {stampRingRatio < 1 && (
            <circle
              cx={CENTER}
              cy={CENTER}
              r={RADIUS * stampRingRatio}
              fill="rgba(16,185,129,0.18)"
              stroke="rgba(74,222,128,0.6)"
              strokeDasharray="3 3"
            />
          )}

          {/* スイープアニメーション */}
          <g
            style={{
              transformOrigin: `${CENTER}px ${CENTER}px`,
              animation: "radar-sweep 4s linear infinite",
            }}
          >
            <path
              d={`M${CENTER},${CENTER} L${CENTER + RADIUS},${CENTER} A${RADIUS},${RADIUS} 0 0 0 ${
                CENTER + RADIUS * Math.cos(-Math.PI / 4)
              },${CENTER + RADIUS * Math.sin(-Math.PI / 4)} Z`}
              fill="url(#sweep)"
            />
          </g>

          {/* ドット */}
          {dots.map(({ store, x, y, dist, visited }) => {
            const inRange = dist <= STAMP_RADIUS_M && !visited;
            return (
              <g key={store.id}>
                {inRange && <circle cx={x} cy={y} r={12} fill="url(#dot-glow)" />}
                <circle
                  cx={x}
                  cy={y}
                  r={inRange ? 4 : 3}
                  fill={
                    visited
                      ? "rgba(160,160,160,0.5)"
                      : inRange
                        ? "#fbbf24"
                        : "#4ade80"
                  }
                >
                  {inRange && (
                    <animate
                      attributeName="r"
                      values="4;7;4"
                      dur="0.9s"
                      repeatCount="indefinite"
                    />
                  )}
                </circle>
              </g>
            );
          })}

          {/* 中央：自分 */}
          <circle cx={CENTER} cy={CENTER} r={4} fill="#fff" />
          <circle
            cx={CENTER}
            cy={CENTER}
            r={7}
            fill="none"
            stroke="white"
            strokeOpacity="0.7"
          />

          {/* 北マーカー */}
          <text
            x={CENTER}
            y={14}
            textAnchor="middle"
            fontSize="12"
            fill="rgba(255,255,255,0.7)"
            fontWeight="bold"
          >
            N
          </text>
        </svg>
      </div>

      <p className="mt-2 text-center text-xs text-gray-500">
        圏内: {dots.length} 店舗 / スケール: 半径 {scale.label}
      </p>

      {!orientationEnabled ? (
        <button
          onClick={requestOrientation}
          className="mt-3 w-full rounded-full border border-gray-300 py-2 text-xs text-gray-600"
        >
          方位センサーを有効化（向いてる方向を上に）
        </button>
      ) : (
        <p className="mt-3 text-center text-xs text-emerald-700">
          ● 方位センサー有効（{heading != null ? `${Math.round(heading)}°` : "取得中…"}）
        </p>
      )}
      {orientationError && (
        <p className="mt-2 text-center text-xs text-red-600">{orientationError}</p>
      )}

      <ul className="mt-4 divide-y rounded-lg border">
        {dots.slice(0, 8).map(({ store, dist, visited }) => (
          <li key={store.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            <span className={visited ? "opacity-40" : ""}>{visited ? "✅" : "🟢"}</span>
            <span className="min-w-0 flex-1 truncate">{store.name}</span>
            <span className="font-mono text-xs text-gray-500">
              {dist < 1000 ? `${Math.round(dist)}m` : `${(dist / 1000).toFixed(2)}km`}
            </span>
          </li>
        ))}
      </ul>

      <style jsx global>{`
        @keyframes radar-sweep {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        .bg-gradient-radial {
          background-image: radial-gradient(
            circle,
            var(--tw-gradient-from),
            var(--tw-gradient-via),
            var(--tw-gradient-to)
          );
        }
      `}</style>
    </section>
  );
}
