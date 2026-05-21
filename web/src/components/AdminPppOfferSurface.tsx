"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { PppOfferSurfacePoint, PppOfferSurfaceRequest, PppOfferSurfaceResponse } from "@/types";
import { formatNumber, formatPct, formatUsd } from "@/lib/format";

type ViewMode = "heatmap" | "surface";

interface SurfaceTooltip {
  point: PppOfferSurfacePoint;
  x: number;
  y: number;
}

const MAX_SURFACE_CELLS = 180;
const SURFACE_WIDTH = 12;
const SURFACE_DEPTH = 8;
const SURFACE_HEIGHT = 5.6;

export function AdminPppOfferSurface() {
  const [investmentUsdt, setInvestmentUsdt] = useState(1_000_000);
  const [targetFirmMarginPct, setTargetFirmMarginPct] = useState(5);
  const [participationRoundDownPct, setParticipationRoundDownPct] = useState(0);
  const [includeDeliveryFees, setIncludeDeliveryFees] = useState(true);
  const [minDte, setMinDte] = useState(1);
  const [maxDte, setMaxDte] = useState(365);
  const [minProtectionPct, setMinProtectionPct] = useState(60);
  const [maxProtectionPct, setMaxProtectionPct] = useState(95);
  const [viewMode, setViewMode] = useState<ViewMode>("heatmap");
  const [surface, setSurface] = useState<PppOfferSurfaceResponse | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const didInitialLoadRef = useRef(false);

  const loadSurface = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload: PppOfferSurfaceRequest = {
        investmentUsdt,
        targetFirmMarginBps: Math.max(0, Math.round(targetFirmMarginPct * 100)),
        includeDeliveryFees,
        participationRoundDownBps: Math.max(0, Math.round(participationRoundDownPct * 100)),
        minDte: Math.max(1, Math.round(minDte)),
        maxDte: Math.max(Math.round(minDte), Math.round(maxDte)),
        minProtectionBps: Math.max(1000, Math.round(minProtectionPct * 100)),
        maxProtectionBps: Math.max(Math.round(minProtectionPct * 100), Math.round(maxProtectionPct * 100)),
        maxCells: MAX_SURFACE_CELLS
      };
      const response = await fetch("/api/admin/ppp-offer-surface", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store"
      });
      const data = (await response.json()) as PppOfferSurfaceResponse & { error?: string };
      if (!response.ok) {
        setError(data.error ?? `PPP matrix failed with HTTP ${response.status}`);
        return;
      }
      setSurface(data);
      setSelectedPointId(data.bestPoint?.id ?? data.points[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "PPP matrix failed");
    } finally {
      setLoading(false);
    }
  }, [
    includeDeliveryFees,
    investmentUsdt,
    maxDte,
    maxProtectionPct,
    minDte,
    minProtectionPct,
    participationRoundDownPct,
    targetFirmMarginPct
  ]);

  useEffect(() => {
    if (didInitialLoadRef.current) return;
    didInitialLoadRef.current = true;
    void loadSurface();
  }, [loadSurface]);

  const selectedPoint = useMemo(() => {
    if (!surface) return null;
    return surface.points.find((point) => point.id === selectedPointId) ?? surface.bestPoint ?? surface.points[0] ?? null;
  }, [selectedPointId, surface]);

  const pointsByCell = useMemo(() => {
    const map = new Map<string, PppOfferSurfacePoint>();
    for (const point of surface?.points ?? []) {
      map.set(cellKey(point.expirationTimestamp, point.floorPutStrike), point);
    }
    return map;
  }, [surface]);

  return (
    <div className="stack">
      <div className="admin-card ppp-matrix-card">
        <div className="yield-surface-toolbar">
          <div>
            <h2 className="card-title">PPP client offer matrix</h2>
            <p className="card-copy">
              Floor put strike and expiry define the hedge package. Each eligible cell shows the max client participation
              that still passes target margin, depth, freshness, slippage, and delivery-fee checks.
            </p>
          </div>
          <div className="yield-surface-actions">
            <div className="segmented" aria-label="PPP matrix view">
              <button className={viewMode === "heatmap" ? "active" : ""} onClick={() => setViewMode("heatmap")} type="button">
                Heatmap
              </button>
              <button className={viewMode === "surface" ? "active" : ""} onClick={() => setViewMode("surface")} type="button">
                3D Surface
              </button>
            </div>
            <button className="btn-ghost" onClick={() => void loadSurface()} disabled={loading}>
              {loading ? "Calculating..." : "Refresh matrix"}
            </button>
          </div>
        </div>

        <div className="ppp-matrix-controls">
          <NumberControl label="Investment USDT" value={investmentUsdt} min={50_000} step={50_000} onChange={setInvestmentUsdt} />
          <NumberControl label="Target margin % p.a." value={targetFirmMarginPct} min={0} step={0.1} onChange={setTargetFirmMarginPct} />
          <NumberControl label="Participation rounding %" value={participationRoundDownPct} min={0} step={0.1} onChange={setParticipationRoundDownPct} />
          <NumberControl label="Min DTE" value={minDte} min={1} step={1} onChange={setMinDte} />
          <NumberControl label="Max DTE" value={maxDte} min={minDte} step={1} onChange={setMaxDte} />
          <NumberControl label="Min protection %" value={minProtectionPct} min={10} max={maxProtectionPct} step={1} onChange={setMinProtectionPct} />
          <NumberControl label="Max protection %" value={maxProtectionPct} min={minProtectionPct} max={100} step={1} onChange={setMaxProtectionPct} />
          <label className="ppp-matrix-check">
            <span className="field-label">Delivery fees</span>
            <span className="soft-row">
              <span>Include stress</span>
              <input type="checkbox" checked={includeDeliveryFees} onChange={(event) => setIncludeDeliveryFees(event.target.checked)} />
            </span>
          </label>
        </div>

        <div className="admin-grid yield-metrics">
          <Metric label="Eligible / total cells" value={surface ? `${surface.diagnostics.eligibleCells} / ${surface.points.length}` : "-"} />
          <Metric label="BTC spot reference" value={formatUsd(surface?.spotPrice)} />
          <Metric label="Best participation" value={formatBps(surface?.bestPoint?.quotedParticipationBps)} tone="status-live" />
          <Metric label="Highest frontier protection" value={formatBps(surface?.highestFrontierProtectionBps)} />
          <Metric label="Latest quote age" value={formatAge(surface?.diagnostics.latestQuoteAgeSeconds)} />
          <Metric label="Unique order books" value={surface?.diagnostics.uniqueOrderBooksFetched ?? "-"} />
          <Metric label="Calculation time" value={surface ? `${surface.diagnostics.pricingElapsedMs}ms` : "-"} />
        </div>

        {surface?.diagnostics.truncated ? (
          <p className="card-copy ppp-matrix-note">
            Display capped at {surface.diagnostics.maxCells} live-priced cells from {surface.diagnostics.totalRoughCells} rough
            cells to keep the calculation responsive.
          </p>
        ) : null}

        <div className="ppp-matrix-stage">
          {loading && !surface ? <div className="yield-chart-state">Calculating PPP offer matrix...</div> : null}
          {surface && viewMode === "heatmap" ? (
            <PppHeatmap
              pointsByCell={pointsByCell}
              selectedPointId={selectedPoint?.id ?? null}
              surface={surface}
              onSelect={setSelectedPointId}
            />
          ) : null}
          {surface && viewMode === "surface" ? (
            <PppOfferSurfaceChart
              surface={surface}
              onSelect={setSelectedPointId}
            />
          ) : null}
          {!loading && surface && surface.points.length === 0 ? (
            <div className="yield-chart-state">No PPP matrix cells found for the selected ranges.</div>
          ) : null}
        </div>

        {error ? <p className="card-copy yield-error">{error}</p> : null}
      </div>

      <div className="audit-grid yield-detail-grid">
        <PppPointDetail point={selectedPoint} />
        <div className="admin-card">
          <h2 className="card-title">Matrix notes</h2>
          <div className="soft-row">
            <span>Objective</span>
            <strong>Max client terms</strong>
          </div>
          <div className="soft-row">
            <span>Strike axis</span>
            <strong>Floor put strike</strong>
          </div>
          <div className="soft-row">
            <span>Source</span>
            <strong className="mono">{surface?.source ?? "-"}</strong>
          </div>
          <p className="card-copy" style={{ marginTop: 12 }}>
            Protection is displayed from the selected floor put strike. The PPP model still validates the actual put-spread
            implied floor, so the detail panel shows both the client-facing protection and the hedge-implied floor.
          </p>
        </div>
      </div>
    </div>
  );
}

function PppHeatmap({
  surface,
  pointsByCell,
  selectedPointId,
  onSelect
}: {
  surface: PppOfferSurfaceResponse;
  pointsByCell: Map<string, PppOfferSurfacePoint>;
  selectedPointId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="ppp-heatmap-wrap">
      <div
        className="ppp-heatmap-grid"
        style={{ gridTemplateColumns: `minmax(160px, 190px) repeat(${surface.expiries.length}, minmax(118px, 1fr))` }}
      >
        <div className="ppp-heatmap-corner">Floor strike</div>
        {surface.expiries.map((expiry) => (
          <div className="ppp-heatmap-head" key={expiry.expirationTimestamp}>
            <strong>{expiry.label}</strong>
            <span>{expiry.daysToExpiry}d</span>
          </div>
        ))}
        {surface.floorRows.map((row) => (
          <HeatmapRow
            key={row.floorPutStrike}
            onSelect={onSelect}
            pointsByCell={pointsByCell}
            row={row}
            selectedPointId={selectedPointId}
            surface={surface}
          />
        ))}
      </div>
    </div>
  );
}

function HeatmapRow({
  row,
  surface,
  pointsByCell,
  selectedPointId,
  onSelect
}: {
  row: PppOfferSurfaceResponse["floorRows"][number];
  surface: PppOfferSurfaceResponse;
  pointsByCell: Map<string, PppOfferSurfacePoint>;
  selectedPointId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <div className="ppp-heatmap-row-head">
        <strong>{formatUsd(row.floorPutStrike)}</strong>
        <span>{formatBps(row.floorProtectionBps)} floor strike / spot</span>
      </div>
      {surface.expiries.map((expiry) => {
        const point = pointsByCell.get(cellKey(expiry.expirationTimestamp, row.floorPutStrike));
        if (!point) {
          return <div className="ppp-heatmap-empty" key={expiry.expirationTimestamp} />;
        }
        return (
          <button
            className={`ppp-heatmap-cell ${point.eligible ? "" : "ineligible"} ${point.frontier ? "frontier" : ""} ${point.best ? "best" : ""} ${
              selectedPointId === point.id ? "selected" : ""
            }`}
            aria-label={`${point.expiryLabel} ${formatUsd(point.floorPutStrike)} floor put with ${formatBps(point.quotedParticipationBps)} participation`}
            key={point.id}
            onClick={() => onSelect(point.id)}
            style={heatmapCellStyle(point, surface)}
            title={`${point.expiryLabel} ${formatUsd(point.floorPutStrike)} participation ${formatBps(point.quotedParticipationBps)}`}
            type="button"
          >
            <strong>{formatBps(point.quotedParticipationBps)}</strong>
            <span>{point.eligible ? "eligible" : "failed"}</span>
            {point.best ? <em>Best</em> : point.frontier ? <em>Frontier</em> : null}
          </button>
        );
      })}
    </>
  );
}

function PppOfferSurfaceChart({
  surface,
  onSelect
}: {
  surface: PppOfferSurfaceResponse;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<SurfaceTooltip | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || surface.points.length === 0) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111442);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1000);
    camera.position.set(9.5, 7, -10.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.className = "yield-chart-canvas";
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, SURFACE_HEIGHT * 0.35, 0);
    controls.minDistance = 7;
    controls.maxDistance = 28;
    controls.update();

    scene.add(new THREE.AmbientLight(0xffffff, 0.72));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.05);
    keyLight.position.set(4, 8, 6);
    scene.add(keyLight);
    addSurfaceAxes(scene);

    const ranges = surfaceRanges(surface.points);
    const meshes: THREE.Mesh[] = [];
    const maxParticipation = Math.max(100, surface.maxParticipationBps ?? 100);
    for (const point of surface.points) {
      const height = Math.max(0.08, ((point.quotedParticipationBps ?? 0) / maxParticipation) * SURFACE_HEIGHT);
      const geometry = new THREE.BoxGeometry(0.22, height, 0.22);
      const material = new THREE.MeshStandardMaterial({
        color: pointColor(point, surface),
        roughness: 0.48,
        metalness: 0.03,
        transparent: !point.eligible,
        opacity: point.eligible ? 0.96 : 0.36
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(scale(point.daysToExpiry, ranges.minDte, ranges.maxDte, -SURFACE_WIDTH / 2, SURFACE_WIDTH / 2), height / 2, scale(point.floorPutStrike, ranges.minStrike, ranges.maxStrike, SURFACE_DEPTH / 2, -SURFACE_DEPTH / 2));
      mesh.userData.pointId = point.id;
      meshes.push(mesh);
      scene.add(mesh);
    }

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    function hitPoint(event: PointerEvent): PppOfferSurfacePoint | null {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const [hit] = raycaster.intersectObjects(meshes);
      const pointId = hit?.object.userData.pointId;
      return typeof pointId === "string" ? surface.points.find((point) => point.id === pointId) ?? null : null;
    }

    function onPointerMove(event: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      const point = hitPoint(event);
      setTooltip(point ? { point, x: event.clientX - rect.left + 14, y: event.clientY - rect.top + 14 } : null);
    }

    function onPointerLeave() {
      setTooltip(null);
    }

    function onPointerClick(event: PointerEvent) {
      const point = hitPoint(event);
      if (point) onSelect(point.id);
    }

    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("click", onPointerClick);

    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      const nextWidth = Math.max(320, width);
      const nextHeight = Math.max(420, height);
      renderer.setSize(nextWidth, nextHeight, false);
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    let frameId = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      frameId = window.requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("click", onPointerClick);
      controls.dispose();
      disposeScene(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [onSelect, surface]);

  return (
    <div className="ppp-surface-stage" ref={containerRef}>
      {tooltip ? <PppSurfaceTooltip tooltip={tooltip} /> : null}
    </div>
  );
}

function PppPointDetail({ point }: { point: PppOfferSurfacePoint | null }) {
  if (!point) {
    return (
      <div className="admin-card">
        <h2 className="card-title">Selected cell</h2>
        <p className="card-copy">Load the PPP matrix to inspect a floor-strike and expiry combination.</p>
      </div>
    );
  }

  return (
    <div className="admin-card">
      <div className="row-between">
        <div>
          <h2 className="card-title">Selected cell</h2>
          <p className="card-copy">
            {point.expiryLabel} / {formatUsd(point.floorPutStrike)} floor put
          </p>
        </div>
        <span className={`status-badge ${point.eligible ? "status-live" : "status-stale"}`}>{point.eligible ? "Eligible" : "Failed"}</span>
      </div>
      <div className="metric-grid">
        <Metric label="Participation" value={formatBps(point.quotedParticipationBps)} tone="status-live" />
        <Metric label="Protection" value={formatBps(point.quotedProtectionBps ?? point.floorProtectionBps)} />
        <Metric label="Put-spread floor" value={formatPct(point.putSpreadImpliedFloor, 2)} />
        <Metric label="Margin headroom" value={formatUsd(point.marginHeadroomUsdt, 2)} tone={(point.marginHeadroomUsdt ?? 0) >= 0 ? "status-live" : "status-stale"} />
      </div>
      <div className="soft-row">
        <span>ATM call / put</span>
        <strong className="mono">
          {formatUsd(point.atmCallStrike)} / {formatUsd(point.atmPutStrike)}
        </strong>
      </div>
      <div className="soft-row">
        <span>Minimum scenario P&L</span>
        <strong className="mono">{formatUsd(point.minScenarioPnlUsdt, 2)}</strong>
      </div>
      <div className="soft-row">
        <span>Target profit</span>
        <strong className="mono">{formatUsd(point.targetProfitUsdt, 2)}</strong>
      </div>
      <div className="soft-row">
        <span>Quote age / slippage</span>
        <strong className="mono">
          {formatAge(point.quoteAgeSeconds)} / {formatPct(point.maxSlippagePct, 3)}
        </strong>
      </div>
      <h3 className="card-title" style={{ marginTop: 18 }}>PPP hedge package</h3>
      <table className="trace-table ppp-leg-table">
        <thead>
          <tr>
            <th>Leg</th>
            <th>Instrument</th>
            <th>Contracts</th>
            <th>Avg price</th>
          </tr>
        </thead>
        <tbody>
          {point.legs.map((leg) => (
            <tr key={`${point.id}-${leg.role}`}>
              <td>{formatLegRole(leg.role)}</td>
              <td className="mono">{leg.instrumentName}</td>
              <td className="mono">{formatNumber(leg.requiredContracts, 1)}</td>
              <td className="mono">{formatNumber(leg.averagePrice, 5)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="verification-checks" style={{ marginTop: 14 }}>
        {Object.entries(point.checks).map(([key, ok]) => (
          <span className={`verification-check ${ok ? "" : "red"}`} key={key}>
            {formatCheckLabel(key)} {ok ? "PASS" : "FAIL"}
          </span>
        ))}
      </div>
    </div>
  );
}

function NumberControl({
  label,
  value,
  min,
  max,
  step,
  onChange
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="yield-range-control">
      <span className="field-label">{label}</span>
      <input
        className="admin-input"
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function Metric({
  label,
  value,
  tone
}: {
  label: string;
  value: React.ReactNode;
  tone?: "status-live" | "status-stale";
}) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${tone === "status-live" ? "green" : tone === "status-stale" ? "red" : ""}`}>{value}</div>
    </div>
  );
}

function PppSurfaceTooltip({ tooltip }: { tooltip: SurfaceTooltip }) {
  const { point } = tooltip;
  return (
    <div className="yield-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
      <strong className="mono">{point.expiryLabel} / {formatUsd(point.floorPutStrike)}</strong>
      <span>Protection {formatBps(point.quotedProtectionBps ?? point.floorProtectionBps)}</span>
      <span>Participation {formatBps(point.quotedParticipationBps)}</span>
      <strong className={point.eligible ? "green" : "red"}>{point.eligible ? "Eligible" : "Failed checks"}</strong>
    </div>
  );
}

function heatmapCellStyle(point: PppOfferSurfacePoint, surface: PppOfferSurfaceResponse): React.CSSProperties {
  if (!point.eligible) return {};
  const min = surface.minParticipationBps ?? 0;
  const max = Math.max(min + 1, surface.maxParticipationBps ?? min + 1);
  const t = clamp(((point.quotedParticipationBps ?? min) - min) / (max - min), 0, 1);
  const low = [93, 140, 255];
  const mid = [0, 179, 126];
  const high = [242, 201, 76];
  const color = t < 0.62 ? mixColor(low, mid, t / 0.62) : mixColor(mid, high, (t - 0.62) / 0.38);
  return {
    background: `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${0.2 + t * 0.58})`,
    borderColor: `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.7)`
  };
}

function pointColor(point: PppOfferSurfacePoint, surface: PppOfferSurfaceResponse): THREE.Color {
  if (!point.eligible) return new THREE.Color(0x7d86aa);
  if (point.best) return new THREE.Color(0xf2c94c);
  if (point.frontier) return new THREE.Color(0x00b37e);
  const min = surface.minParticipationBps ?? 0;
  const max = Math.max(min + 1, surface.maxParticipationBps ?? min + 1);
  const t = clamp(((point.quotedParticipationBps ?? min) - min) / (max - min), 0, 1);
  return new THREE.Color(0x5d8cff).lerp(new THREE.Color(0x00b37e), t);
}

function addSurfaceAxes(scene: THREE.Scene) {
  const group = new THREE.Group();
  const floorColor = 0x7d86aa;
  const axisColor = 0xd9e1ff;
  const x0 = -SURFACE_WIDTH / 2;
  const x1 = SURFACE_WIDTH / 2;
  const z0 = -SURFACE_DEPTH / 2;
  const z1 = SURFACE_DEPTH / 2;
  for (let i = 0; i <= 6; i += 1) {
    const x = x0 + (i / 6) * SURFACE_WIDTH;
    group.add(line([new THREE.Vector3(x, 0, z0), new THREE.Vector3(x, 0, z1)], floorColor, 0.2));
  }
  for (let i = 0; i <= 5; i += 1) {
    const z = z0 + (i / 5) * SURFACE_DEPTH;
    group.add(line([new THREE.Vector3(x0, 0, z), new THREE.Vector3(x1, 0, z)], floorColor, 0.2));
  }
  group.add(line([new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, 0, z0)], axisColor, 0.9));
  group.add(line([new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x0, SURFACE_HEIGHT, z0)], axisColor, 0.9));
  group.add(line([new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x0, 0, z1)], axisColor, 0.9));
  scene.add(group);
}

function surfaceRanges(points: PppOfferSurfacePoint[]) {
  return {
    minDte: Math.min(...points.map((point) => point.daysToExpiry)),
    maxDte: Math.max(...points.map((point) => point.daysToExpiry)),
    minStrike: Math.min(...points.map((point) => point.floorPutStrike)),
    maxStrike: Math.max(...points.map((point) => point.floorPutStrike))
  };
}

function line(points: THREE.Vector3[], color: number, opacity: number): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  return new THREE.Line(geometry, material);
}

function disposeScene(scene: THREE.Scene) {
  scene.traverse((object) => {
    if ("geometry" in object && object.geometry instanceof THREE.BufferGeometry) {
      object.geometry.dispose();
    }
    if ("material" in object) {
      const material = object.material as THREE.Material | THREE.Material[] | undefined;
      const materials = Array.isArray(material) ? material : material ? [material] : [];
      for (const item of materials) item.dispose();
    }
  });
}

function cellKey(expirationTimestamp: number, floorPutStrike: number) {
  return `${expirationTimestamp}:${floorPutStrike}`;
}

function formatBps(value: number | null | undefined, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value) ? `${(value / 100).toFixed(digits)}%` : "-";
}

function formatAge(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return "-";
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  return `${(seconds / 60).toFixed(1)}m`;
}

function formatLegRole(role: string): string {
  return role
    .split("_")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function formatCheckLabel(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
}

function scale(value: number, min: number, max: number, outMin: number, outMax: number): number {
  if (max === min) return (outMin + outMax) / 2;
  return outMin + ((value - min) / (max - min)) * (outMax - outMin);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mixColor(a: number[], b: number[], t: number): number[] {
  return a.map((value, index) => Math.round(value + (b[index] - value) * clamp(t, 0, 1)));
}
