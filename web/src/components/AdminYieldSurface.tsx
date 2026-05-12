"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { YieldSurfacePoint, YieldSurfaceResponse } from "@/types";
import { formatNumber, formatPct, formatUsd } from "@/lib/format";

type OptionType = "put" | "call";

interface TooltipState {
  point: YieldSurfacePoint;
  x: number;
  y: number;
}

interface RenderRanges {
  minStrike: number;
  maxStrike: number;
  minDte: number;
  maxDte: number;
  minYield: number;
  maxYield: number;
}

interface SurfaceVertex {
  position: THREE.Vector3;
  annualizedYield: number;
  nearestPoint: YieldSurfacePoint;
}

interface NormalizedSample {
  point: YieldSurfacePoint;
  x: number;
  z: number;
  annualizedYield: number;
}

interface NearestSample {
  sample: NormalizedSample;
  distanceSquared: number;
}

interface SurfaceControls {
  minStrike: number;
  maxStrike: number;
  minDte: number;
  maxDte: number;
  maxYield: number;
}

type SurfaceRange = Omit<SurfaceControls, "maxYield">;

interface SurfaceDisplayUniverse {
  points: YieldSurfacePoint[];
  extents: SurfaceRange;
  maxYield: number;
}

const SURFACE_WIDTH = 14;
const SURFACE_DEPTH = 9;
const SURFACE_HEIGHT = 5.8;
const DISPLAY_MIN_DTE = 1;
const DISPLAY_MAX_DTE = 365;
const DEFAULT_MAX_ANNUALIZED_YIELD = 1.5;
const MIN_SURFACE_STRIKE_STEPS = 28;
const MAX_SURFACE_STRIKE_STEPS = 56;
const MIN_SURFACE_DTE_STEPS = 18;
const MAX_SURFACE_DTE_STEPS = 38;
const SURFACE_NEIGHBOR_COUNT = 14;
const SURFACE_DTE_DISTANCE_WEIGHT = 1.2;
const SURFACE_OUTLIER_MAD_MULTIPLIER = 2.6;
const SURFACE_LOCAL_BLEND = 0.65;
const SURFACE_SMOOTHING_PASSES = 3;
const SURFACE_SMOOTHING_CENTER_WEIGHT = 0.6;
const DEFAULT_CAMERA_POSITION = new THREE.Vector3(10.8, 7.4, -11.6);
const DEFAULT_CAMERA_TARGET = new THREE.Vector3(0.4, SURFACE_HEIGHT * 0.42, 0.25);

export function AdminYieldSurface() {
  const [optionType, setOptionType] = useState<OptionType>("put");
  const [surface, setSurface] = useState<YieldSurfaceResponse | null>(null);
  const [controls, setControls] = useState<SurfaceControls | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSurface = useCallback(async (nextType: OptionType = optionType) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/yield-surface?type=${nextType}`, { cache: "no-store" });
      const payload = (await response.json()) as YieldSurfaceResponse & { error?: string };
      if (!response.ok) {
        setError(payload.error ?? `Yield surface failed with HTTP ${response.status}`);
        return;
      }
      setSurface(payload);
      setControls(defaultControlsForSurface(payload));
    } finally {
      setLoading(false);
    }
  }, [optionType]);

  useEffect(() => {
    void loadSurface(optionType);
  }, [loadSurface, optionType]);

  async function refreshMarket() {
    setRefreshing(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/sync-market-data", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store"
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setError(payload.error ?? `Market sync failed with HTTP ${response.status}`);
        return;
      }
      await loadSurface(optionType);
    } finally {
      setRefreshing(false);
    }
  }

  const bestPoint = useMemo(() => {
    if (!surface?.points.length) return null;
    return [...buildDisplaySurface(surface, controls).points].sort((a, b) => b.annualizedYield - a.annualizedYield)[0] ?? null;
  }, [controls, surface]);

  const displayUniverse = useMemo(() => (surface ? getDisplayUniverse(surface) : null), [surface]);
  const displaySurface = useMemo(() => (surface ? buildDisplaySurface(surface, controls) : null), [controls, surface]);

  const quoteTone =
    surface?.latestQuoteAgeSeconds === null || surface?.latestQuoteAgeSeconds === undefined
      ? "status-warn"
      : surface.latestQuoteAgeSeconds <= 180
        ? "status-live"
        : "status-stale";

  return (
    <div className="stack">
      <div className="admin-card yield-surface-card">
        <div className="yield-surface-toolbar">
          <div>
            <h2 className="card-title">Annualized premium yield surface</h2>
            <p className="card-copy">
              Top-of-book Deribit bid premium annualized per 1 BTC contract: bid price / DTE * 365.
            </p>
          </div>
          <div className="yield-surface-actions">
            <div className="segmented" aria-label="Option type">
              <button
                className={optionType === "put" ? "active" : ""}
                onClick={() => setOptionType("put")}
                type="button"
              >
                Puts
              </button>
              <button
                className={optionType === "call" ? "active" : ""}
                onClick={() => setOptionType("call")}
                type="button"
              >
                Calls
              </button>
            </div>
            <button className="btn-ghost" onClick={() => void refreshMarket()} disabled={loading || refreshing}>
              {refreshing ? "Refreshing..." : "Refresh Deribit"}
            </button>
          </div>
        </div>

        <div className="admin-grid yield-metrics">
          <Metric label="Visible / live points" value={surface && displaySurface ? `${displaySurface.points.length} / ${surface.points.length}` : "-"} />
          <Metric label="Visible expiries" value={displaySurface?.expiries.length ?? "-"} />
          <Metric label="Visible yield range" value={formatYieldRange(displaySurface)} />
          <Metric label="Latest quote age" value={formatAge(surface?.latestQuoteAgeSeconds)} tone={quoteTone} />
          <Metric label="Highest visible yield" value={bestPoint ? formatPct(bestPoint.annualizedYield, 2) : "-"} />
        </div>

        {surface && controls && displayUniverse ? (
          <SurfaceFilterControls
            controls={controls}
            extents={displayUniverse.extents}
            maxYieldExtent={displayUniverse.maxYield}
            onChange={setControls}
            onReset={() => setControls(defaultControlsForSurface(surface))}
          />
        ) : null}

        <div className="yield-chart-wrap">
          {loading && !surface ? <div className="yield-chart-state">Loading surface...</div> : null}
          {displaySurface ? <YieldSurfaceChart surface={displaySurface} /> : null}
          {!loading && displaySurface && displaySurface.points.length === 0 ? (
            <div className="yield-chart-state">No positive live bids found for this option type.</div>
          ) : null}
        </div>

        {error ? <p className="card-copy yield-error">{error}</p> : null}
      </div>

      <div className="audit-grid yield-detail-grid">
        <div className="admin-card">
          <h2 className="card-title">Surface notes</h2>
          <div className="soft-row">
            <span>Formula</span>
            <strong className="mono">{surface?.formula.expression ?? "bidPrice / daysToExpiry * 365"}</strong>
          </div>
          <div className="soft-row">
            <span>Source</span>
            <strong className="mono">{surface?.source ?? "d1_latest"}</strong>
          </div>
          <div className="soft-row">
            <span>Interpretation</span>
            <strong>Premium yield only</strong>
          </div>
          <p className="card-copy" style={{ marginTop: 12 }}>
            This is a current reference surface using live bid prices. It is not collateral-adjusted return, depth-weighted
            executable return, or a guarantee that the same trade can be repeated.
          </p>
          <p className="card-copy" style={{ marginTop: 8 }}>
            The chart covers all live non-expired expiries by default, with a broad strike window and annualized
            premium yield below 150% for readability. The API payload still includes the full live surface.
          </p>
        </div>

        <div className="admin-card">
          <h2 className="card-title">Best point</h2>
          {bestPoint ? (
            <>
              <div className="soft-row">
                <span>Instrument</span>
                <strong className="mono">{bestPoint.instrumentName}</strong>
              </div>
              <div className="metric-grid">
                <Metric label="Strike" value={formatUsd(bestPoint.strike)} />
                <Metric label="Expiry" value={`${bestPoint.expiryLabel} (${bestPoint.daysToExpiry}d)`} />
                <Metric label="Bid" value={formatNumber(bestPoint.bidPrice, 5)} />
                <Metric label="Annualized yield" value={formatPct(bestPoint.annualizedYield, 2)} tone="status-live" />
              </div>
            </>
          ) : (
            <p className="card-copy">Load a surface to view the highest positive bid yield.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function YieldSurfaceChart({ surface }: { surface: YieldSurfaceResponse }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || surface.points.length === 0) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111442);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1000);
    camera.position.copy(DEFAULT_CAMERA_POSITION);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.className = "yield-chart-canvas";
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.copy(DEFAULT_CAMERA_TARGET);
    controls.minDistance = 8;
    controls.maxDistance = 32;
    controls.update();

    scene.add(new THREE.AmbientLight(0xffffff, 0.72));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
    keyLight.position.set(3, 8, 6);
    scene.add(keyLight);

    const interpolatedSurface = buildInterpolatedSurface(surface.points);
    const ranges = interpolatedSurface.ranges;
    const surfacePositions = interpolatedSurface.positions;
    const surfaceColors = interpolatedSurface.colors;
    const surfaceIndices = interpolatedSurface.indices;
    const rawSamples = interpolatedSurface.rawSamples;

    let surfaceMesh: THREE.Mesh | null = null;
    if (surfacePositions.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(surfacePositions, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(surfaceColors, 3));
      geometry.setIndex(surfaceIndices);
      geometry.computeVertexNormals();
      surfaceMesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          side: THREE.DoubleSide,
          vertexColors: true,
          roughness: 0.48,
          metalness: 0.04,
          transparent: true,
          opacity: 0.94
        })
      );
      scene.add(surfaceMesh);

      const wireframe = new THREE.LineSegments(
        new THREE.WireframeGeometry(geometry),
        new THREE.LineBasicMaterial({
          color: 0xd9e1ff,
          transparent: true,
          opacity: 0.12
        })
      );
      scene.add(wireframe);
    }
    addAxes(scene, surface, ranges);

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    function onPointerMove(event: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);

      if (surfaceMesh) {
        const [hit] = raycaster.intersectObject(surfaceMesh);
        if (hit) {
          const point = nearestHitPoint(hit.point, ranges, rawSamples);
          setTooltip({ point, x: event.clientX - rect.left + 14, y: event.clientY - rect.top + 14 });
          return;
        }
      }
      setTooltip(null);
    }

    function onPointerLeave() {
      setTooltip(null);
    }

    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);

    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      const nextWidth = Math.max(320, width);
      const nextHeight = Math.max(360, height);
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
      controls.dispose();
      disposeScene(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [surface]);

  return (
    <div className="yield-chart-stage" ref={containerRef}>
      {tooltip ? <YieldTooltip tooltip={tooltip} /> : null}
    </div>
  );
}

function SurfaceFilterControls({
  controls,
  extents,
  maxYieldExtent,
  onChange,
  onReset
}: {
  controls: SurfaceControls;
  extents: SurfaceRange;
  maxYieldExtent: number;
  onChange: (controls: SurfaceControls) => void;
  onReset: () => void;
}) {
  const strikeStep = getStrikeStep(extents);
  return (
    <div className="yield-filter-panel">
      <div className="yield-filter-head">
        <div>
          <h3 className="card-title">Surface display range</h3>
          <p className="card-copy">Trim extreme strikes or expiries without changing the live data source.</p>
        </div>
        <button className="btn-ghost" type="button" onClick={onReset}>
          Reset range
        </button>
      </div>
      <div className="yield-filter-grid">
        <RangeControl
          label="Min strike"
          value={controls.minStrike}
          min={extents.minStrike}
          max={Math.min(controls.maxStrike - strikeStep, extents.maxStrike)}
          step={strikeStep}
          display={formatUsd(controls.minStrike)}
          onChange={(value) => onChange({ ...controls, minStrike: Math.min(value, controls.maxStrike - strikeStep) })}
        />
        <RangeControl
          label="Max strike"
          value={controls.maxStrike}
          min={Math.max(controls.minStrike + strikeStep, extents.minStrike)}
          max={extents.maxStrike}
          step={strikeStep}
          display={formatUsd(controls.maxStrike)}
          onChange={(value) => onChange({ ...controls, maxStrike: Math.max(value, controls.minStrike + strikeStep) })}
        />
        <RangeControl
          label="Min expiry"
          value={controls.minDte}
          min={extents.minDte}
          max={Math.min(controls.maxDte - 1, extents.maxDte)}
          step={1}
          display={`${controls.minDte}d`}
          onChange={(value) => onChange({ ...controls, minDte: Math.min(value, controls.maxDte - 1) })}
        />
        <RangeControl
          label="Max expiry"
          value={controls.maxDte}
          min={Math.max(controls.minDte + 1, extents.minDte)}
          max={extents.maxDte}
          step={1}
          display={`${controls.maxDte}d`}
          onChange={(value) => onChange({ ...controls, maxDte: Math.max(value, controls.minDte + 1) })}
        />
        <RangeControl
          label="Max yield"
          value={controls.maxYield}
          min={0.25}
          max={Math.max(0.25, maxYieldExtent)}
          step={0.25}
          display={formatPct(controls.maxYield, 0)}
          onChange={(value) => onChange({ ...controls, maxYield: value })}
        />
      </div>
    </div>
  );
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="yield-range-control">
      <span className="field-label">{label}</span>
      <strong className="mono">{display}</strong>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function YieldTooltip({ tooltip }: { tooltip: TooltipState }) {
  const { point } = tooltip;
  return (
    <div className="yield-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
      <strong className="mono">{point.instrumentName}</strong>
      <span>{point.optionType.toUpperCase()} / {formatUsd(point.strike)} / {point.expiryLabel}</span>
      <span>DTE {point.daysToExpiry} / Bid {formatNumber(point.bidPrice, 5)} / Size {formatNumber(point.bidAmount, 1)}</span>
      <strong className="green">{formatPct(point.annualizedYield, 2)} p.a.</strong>
    </div>
  );
}

function buildDisplaySurface(surface: YieldSurfaceResponse, controls: SurfaceControls | null): YieldSurfaceResponse {
  const universe = getDisplayUniverse(surface);
  const range = controls ?? defaultControlsForSurface(surface);
  const filtered = universe.points.filter((point) => {
    if (point.daysToExpiry < range.minDte || point.daysToExpiry > range.maxDte) return false;
    if (point.strike < range.minStrike || point.strike > range.maxStrike) return false;
    if (point.annualizedYield > range.maxYield) return false;
    return true;
  });
  const points = hasUsableSurface(filtered) ? filtered : buildPercentileFallback(universe.points);
  const strikes = Array.from(new Set(points.map((point) => point.strike))).sort((a, b) => a - b);
  const expiries = summarizeExpiries(points);
  const yields = points.map((point) => point.annualizedYield);

  return {
    ...surface,
    points,
    strikes,
    expiries,
    minAnnualizedYield: minFinite(yields),
    maxAnnualizedYield: maxFinite(yields),
    filters: {
      ...surface.filters,
      minDte: range.minDte,
      maxDte: range.maxDte,
      minStrike: range.minStrike,
      maxStrike: range.maxStrike
    }
  };
}

function getDisplayUniverse(surface: YieldSurfaceResponse): SurfaceDisplayUniverse {
  const points = surface.points.filter((point) => {
    if (point.daysToExpiry < DISPLAY_MIN_DTE || point.daysToExpiry > DISPLAY_MAX_DTE) return false;
    return true;
  });
  const yields = points.map((point) => point.annualizedYield);
  return {
    points,
    extents: getSurfaceExtents(points.length > 0 ? points : surface.points),
    maxYield: maxFinite(yields) ?? DEFAULT_MAX_ANNUALIZED_YIELD
  };
}

function buildPercentileFallback(points: YieldSurfacePoint[]): YieldSurfacePoint[] {
  const dteFiltered = points.filter((point) => point.daysToExpiry >= 8 && point.daysToExpiry <= DISPLAY_MAX_DTE);
  const candidates = dteFiltered.length > 0 ? dteFiltered : points;
  const cap = Math.min(DEFAULT_MAX_ANNUALIZED_YIELD, percentile(candidates.map((point) => point.annualizedYield), 0.9) ?? DEFAULT_MAX_ANNUALIZED_YIELD);
  return candidates.filter((point) => point.annualizedYield <= cap);
}

function defaultControlsForSurface(surface: YieldSurfaceResponse): SurfaceControls {
  const universe = getDisplayUniverse(surface);
  const extents = universe.extents;
  return {
    minStrike: extents.minStrike,
    maxStrike: extents.maxStrike,
    minDte: Math.max(DISPLAY_MIN_DTE, extents.minDte),
    maxDte: Math.min(DISPLAY_MAX_DTE, extents.maxDte),
    maxYield: Math.min(DEFAULT_MAX_ANNUALIZED_YIELD, universe.maxYield)
  };
}

function getSurfaceExtents(points: YieldSurfacePoint[]): SurfaceRange {
  const strikes = points.map((point) => point.strike);
  const dtes = points.map((point) => point.daysToExpiry);
  return {
    minStrike: Math.min(...strikes),
    maxStrike: Math.max(...strikes),
    minDte: Math.min(...dtes),
    maxDte: Math.max(...dtes)
  };
}

function getStrikeStep(extents: SurfaceRange): number {
  const rawStep = Math.max(1000, Math.round((extents.maxStrike - extents.minStrike) / 120));
  return Math.ceil(rawStep / 500) * 500;
}

function hasUsableSurface(points: YieldSurfacePoint[]): boolean {
  const strikeCount = new Set(points.map((point) => point.strike)).size;
  const expiryCount = new Set(points.map((point) => point.expirationTimestamp)).size;
  return points.length >= 12 && strikeCount >= 4 && expiryCount >= 3;
}

function summarizeExpiries(points: YieldSurfacePoint[]) {
  const map = new Map<number, { expirationTimestamp: number; label: string; daysToExpiry: number; pointCount: number }>();
  for (const point of points) {
    const existing = map.get(point.expirationTimestamp);
    if (existing) {
      existing.pointCount += 1;
    } else {
      map.set(point.expirationTimestamp, {
        expirationTimestamp: point.expirationTimestamp,
        label: point.expiryLabel,
        daysToExpiry: point.daysToExpiry,
        pointCount: 1
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.expirationTimestamp - b.expirationTimestamp);
}

function buildInterpolatedSurface(points: YieldSurfacePoint[]) {
  const coordinateRanges = getCoordinateRanges(points);
  const strikeSteps = Math.min(
    MAX_SURFACE_STRIKE_STEPS,
    Math.max(MIN_SURFACE_STRIKE_STEPS, Math.round(Math.sqrt(points.length) * 4))
  );
  const dteSteps = Math.min(
    MAX_SURFACE_DTE_STEPS,
    Math.max(MIN_SURFACE_DTE_STEPS, new Set(points.map((point) => point.expirationTimestamp)).size * 4)
  );
  const rawSamples = points.map((point) => ({
    point,
    x: normalize(point.strike, coordinateRanges.minStrike, coordinateRanges.maxStrike),
    z: normalize(point.daysToExpiry, coordinateRanges.minDte, coordinateRanges.maxDte),
    annualizedYield: point.annualizedYield
  }));
  const samples = buildTerrainSamples(rawSamples);
  const xCoordinates = buildSurfaceCoordinates(
    rawSamples.map((sample) => sample.x),
    strikeSteps
  );
  const zCoordinates = buildSurfaceCoordinates(
    rawSamples.map((sample) => sample.z),
    dteSteps
  );
  const grid: SurfaceVertex[][] = [];

  for (const zNorm of zCoordinates) {
    const row: SurfaceVertex[] = [];
    for (const xNorm of xCoordinates) {
      const interpolated = interpolateYield(samples, xNorm, zNorm);
      row.push({
        nearestPoint: interpolated.nearestPoint,
        annualizedYield: interpolated.annualizedYield,
        position: new THREE.Vector3(
          scale(xNorm, 0, 1, SURFACE_WIDTH / 2, -SURFACE_WIDTH / 2),
          0,
          scale(zNorm, 0, 1, -SURFACE_DEPTH / 2, SURFACE_DEPTH / 2)
        )
      });
    }
    grid.push(row);
  }

  smoothSurfaceGrid(grid, SURFACE_SMOOTHING_PASSES);

  const terrainMax =
    maxFinite([...grid.flat().map((vertex) => vertex.annualizedYield), ...samples.map((sample) => sample.annualizedYield)]) ??
    maxFinite(points.map((point) => point.annualizedYield)) ??
    0.01;
  const ranges: RenderRanges = {
    ...coordinateRanges,
    minYield: 0,
    maxYield: Math.max(0.01, terrainMax * 1.08)
  };

  for (const [zIndex, row] of grid.entries()) {
    const zNorm = zCoordinates[zIndex];
    for (const [xIndex, vertex] of row.entries()) {
      const xNorm = xCoordinates[xIndex];
      vertex.position.set(
        scale(xNorm, 0, 1, SURFACE_WIDTH / 2, -SURFACE_WIDTH / 2),
        scale(vertex.annualizedYield, ranges.minYield, ranges.maxYield, 0, SURFACE_HEIGHT),
        scale(zNorm, 0, 1, -SURFACE_DEPTH / 2, SURFACE_DEPTH / 2)
      );
    }
  }

  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (const row of grid) {
    for (const vertex of row) {
      const color = colorForYield(vertex.annualizedYield, ranges);
      positions.push(vertex.position.x, vertex.position.y, vertex.position.z);
      colors.push(color.r, color.g, color.b);
    }
  }

  const rowWidth = xCoordinates.length;
  for (let zIndex = 0; zIndex < zCoordinates.length - 1; zIndex += 1) {
    for (let xIndex = 0; xIndex < xCoordinates.length - 1; xIndex += 1) {
      const topLeft = zIndex * rowWidth + xIndex;
      const topRight = topLeft + 1;
      const bottomLeft = (zIndex + 1) * rowWidth + xIndex;
      const bottomRight = bottomLeft + 1;
      indices.push(topLeft, topRight, bottomRight, topLeft, bottomRight, bottomLeft);
    }
  }

  return { positions, colors, indices, ranges, rawSamples };
}

function buildSurfaceCoordinates(sampleCoordinates: number[], baseSteps: number): number[] {
  const coordinates = new Set<number>();
  for (let index = 0; index < baseSteps; index += 1) {
    coordinates.add(roundCoordinate(baseSteps === 1 ? 0.5 : index / (baseSteps - 1)));
  }
  for (const coordinate of sampleCoordinates) {
    coordinates.add(roundCoordinate(coordinate));
  }
  coordinates.add(0);
  coordinates.add(1);
  return Array.from(coordinates).sort((a, b) => a - b);
}

function buildTerrainSamples(samples: NormalizedSample[]): NormalizedSample[] {
  if (samples.length <= 2) return samples;

  return samples.map((sample) => {
    const nearest = nearestSamples(samples, sample.x, sample.z);
    const localValues = nearest.map((item) => item.sample.annualizedYield);
    const localMedian = median(localValues) ?? sample.annualizedYield;
    const localMad = median(localValues.map((value) => Math.abs(value - localMedian))) ?? 0;
    const localFloor = Math.max(Math.abs(localMedian) * 0.08, 0.01);
    const allowedMove = Math.max(localMad * SURFACE_OUTLIER_MAD_MULTIPLIER, localFloor);
    const lowerBound = Math.max(0, localMedian - allowedMove);
    const upperBound = localMedian + allowedMove;

    let weightSum = 0;
    let yieldSum = 0;
    for (const item of nearest) {
      const weight = inverseDistanceWeight(item.distanceSquared);
      weightSum += weight;
      yieldSum += clamp(item.sample.annualizedYield, lowerBound, upperBound) * weight;
    }

    const localAverage = weightSum === 0 ? localMedian : yieldSum / weightSum;
    const clampedSelf = clamp(sample.annualizedYield, lowerBound, upperBound);
    return {
      ...sample,
      annualizedYield: clampedSelf * (1 - SURFACE_LOCAL_BLEND) + localAverage * SURFACE_LOCAL_BLEND
    };
  });
}

function interpolateYield(samples: NormalizedSample[], x: number, z: number) {
  const nearest = nearestSamples(samples, x, z);

  if (nearest.length === 0) {
    throw new Error("Cannot interpolate an empty yield surface");
  }

  let weightSum = 0;
  let yieldSum = 0;
  for (const item of nearest) {
    const weight = inverseDistanceWeight(item.distanceSquared);
    weightSum += weight;
    yieldSum += item.sample.annualizedYield * weight;
  }

  return {
    nearestPoint: nearest[0].sample.point,
    annualizedYield: yieldSum / weightSum
  };
}

function nearestSamples(samples: NormalizedSample[], x: number, z: number): NearestSample[] {
  return samples
    .map((sample) => {
      const xDistance = x - sample.x;
      const zDistance = (z - sample.z) * SURFACE_DTE_DISTANCE_WEIGHT;
      return {
        sample,
        distanceSquared: xDistance * xDistance + zDistance * zDistance
      };
    })
    .sort((a, b) => a.distanceSquared - b.distanceSquared)
    .slice(0, Math.min(SURFACE_NEIGHBOR_COUNT, samples.length));
}

function inverseDistanceWeight(distanceSquared: number): number {
  return 1 / Math.pow(distanceSquared + 0.0025, 1.35);
}

function smoothSurfaceGrid(grid: SurfaceVertex[][], passes: number) {
  if (grid.length === 0) return;
  let values = grid.map((row) => row.map((vertex) => vertex.annualizedYield));

  for (let pass = 0; pass < passes; pass += 1) {
    values = values.map((row, zIndex) =>
      row.map((value, xIndex) => {
        let neighborSum = 0;
        let neighborCount = 0;
        for (let zOffset = -1; zOffset <= 1; zOffset += 1) {
          for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
            if (zOffset === 0 && xOffset === 0) continue;
            const neighborRow = values[zIndex + zOffset];
            const neighborValue = neighborRow?.[xIndex + xOffset];
            if (typeof neighborValue !== "number") continue;
            neighborSum += neighborValue;
            neighborCount += 1;
          }
        }
        if (neighborCount === 0) return value;
        return value * SURFACE_SMOOTHING_CENTER_WEIGHT + (neighborSum / neighborCount) * (1 - SURFACE_SMOOTHING_CENTER_WEIGHT);
      })
    );
  }

  for (const [zIndex, row] of grid.entries()) {
    for (const [xIndex, vertex] of row.entries()) {
      vertex.annualizedYield = values[zIndex][xIndex];
    }
  }
}

function addAxes(scene: THREE.Scene, surface: YieldSurfaceResponse, ranges: RenderRanges) {
  const group = new THREE.Group();
  const floorColor = 0x7d86aa;
  const axisColor = 0xd9e1ff;

  const x0 = -SURFACE_WIDTH / 2;
  const x1 = SURFACE_WIDTH / 2;
  const z0 = -SURFACE_DEPTH / 2;
  const z1 = SURFACE_DEPTH / 2;
  const yAxisX = x1;
  const yAxisZ = z0;

  for (const strike of sampleValues(surface.strikes, 6)) {
    const x = scaleStrike(strike, ranges);
    group.add(line([new THREE.Vector3(x, 0, z0), new THREE.Vector3(x, 0, z1)], floorColor, 0.34));
    const label = makeTextSprite(formatUsd(strike), 0.72);
    label.position.set(x, -0.28, z0 - 0.56);
    group.add(label);
  }

  const expiryTicks = selectExpiryTicks(surface.expiries, 6, 18);
  for (const expiry of expiryTicks) {
    const z = scale(expiry.daysToExpiry, ranges.minDte, ranges.maxDte, z0, z1);
    group.add(line([new THREE.Vector3(x0, 0, z), new THREE.Vector3(x1, 0, z)], floorColor, 0.34));
    const label = makeTextSprite(`${expiry.label} ${expiry.daysToExpiry}d`, 0.7);
    label.position.set(x1 + 0.95, -0.34, z);
    group.add(label);
  }

  const yTicks = [0, ranges.maxYield / 2, ranges.maxYield];
  for (const value of yTicks) {
    const y = scale(value, ranges.minYield, ranges.maxYield, 0, SURFACE_HEIGHT);
    group.add(line([new THREE.Vector3(yAxisX, y, yAxisZ), new THREE.Vector3(yAxisX, y, z1)], floorColor, 0.24));
    const label = makeTextSprite(formatPct(value, 0), 0.7);
    label.position.set(yAxisX + 0.72, y, yAxisZ);
    group.add(label);
  }

  group.add(line([new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, 0, z0)], axisColor, 0.9));
  group.add(line([new THREE.Vector3(yAxisX, 0, yAxisZ), new THREE.Vector3(yAxisX, SURFACE_HEIGHT, yAxisZ)], axisColor, 0.9));
  group.add(line([new THREE.Vector3(x1, 0, z0), new THREE.Vector3(x1, 0, z1)], axisColor, 0.9));

  const xLabel = makeTextSprite("Strike", 1.1);
  xLabel.position.set(0, -0.58, z0 - 1.28);
  group.add(xLabel);

  const zLabel = makeTextSprite("Expiry / DTE", 1.1);
  zLabel.position.set(x1 + 1.46, -0.58, 0);
  group.add(zLabel);

  const yLabel = makeTextSprite("Annualized Yield %", 1.08);
  yLabel.position.set(yAxisX + 1.35, SURFACE_HEIGHT + 0.45, yAxisZ);
  group.add(yLabel);

  scene.add(group);
}

function nearestHitPoint(hitPoint: THREE.Vector3, ranges: RenderRanges, samples: NormalizedSample[]): YieldSurfacePoint {
  const x = normalize(scale(hitPoint.x, SURFACE_WIDTH / 2, -SURFACE_WIDTH / 2, ranges.minStrike, ranges.maxStrike), ranges.minStrike, ranges.maxStrike);
  const z = normalize(scale(hitPoint.z, -SURFACE_DEPTH / 2, SURFACE_DEPTH / 2, ranges.minDte, ranges.maxDte), ranges.minDte, ranges.maxDte);
  return nearestSamples(samples, x, z)[0]?.sample.point ?? samples[0].point;
}

function getCoordinateRanges(points: YieldSurfacePoint[]): Pick<RenderRanges, "minStrike" | "maxStrike" | "minDte" | "maxDte"> {
  const strikes = points.map((point) => point.strike);
  const dtes = points.map((point) => point.daysToExpiry);
  return {
    minStrike: Math.min(...strikes),
    maxStrike: Math.max(...strikes),
    minDte: Math.min(...dtes),
    maxDte: Math.max(...dtes)
  };
}

function scale(value: number, min: number, max: number, outMin: number, outMax: number): number {
  if (max === min) return (outMin + outMax) / 2;
  return outMin + ((value - min) / (max - min)) * (outMax - outMin);
}

function scaleStrike(value: number, ranges: Pick<RenderRanges, "minStrike" | "maxStrike">): number {
  return scale(value, ranges.minStrike, ranges.maxStrike, SURFACE_WIDTH / 2, -SURFACE_WIDTH / 2);
}

function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundCoordinate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function colorForYield(value: number, ranges: RenderRanges): THREE.Color {
  const t = Math.min(1, Math.max(0, (value - ranges.minYield) / (ranges.maxYield - ranges.minYield || 1)));
  const blue = new THREE.Color(0x6f8cff);
  const green = new THREE.Color(0x00b37e);
  const amber = new THREE.Color(0xf2c94c);
  const red = new THREE.Color(0xe85d75);
  if (t < 0.38) return blue.lerp(green, t / 0.38);
  if (t < 0.74) return green.lerp(amber, (t - 0.38) / 0.36);
  return amber.lerp(red, (t - 0.74) / 0.26);
}

function line(points: THREE.Vector3[], color: number, opacity: number): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  return new THREE.Line(geometry, material);
}

function makeTextSprite(text: string, scaleValue: number): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.Sprite();
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = "600 44px Arial";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "rgba(217, 225, 255, 0.96)";
  context.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(scaleValue * 4.8, scaleValue * 0.72, 1);
  return sprite;
}

function sampleValues<T>(values: T[], maxCount: number): T[] {
  if (values.length <= maxCount) return values;
  const sampled: T[] = [];
  for (let index = 0; index < maxCount; index += 1) {
    sampled.push(values[Math.round((index * (values.length - 1)) / (maxCount - 1))]);
  }
  return sampled;
}

function selectExpiryTicks(expiries: YieldSurfaceResponse["expiries"], maxCount: number, minGapDays: number) {
  if (expiries.length <= maxCount) return expiries;
  const sorted = [...expiries].sort((a, b) => a.daysToExpiry - b.daysToExpiry);
  const selected = new Map<number, YieldSurfaceResponse["expiries"][number]>();
  selected.set(sorted[0].expirationTimestamp, sorted[0]);
  selected.set(sorted[sorted.length - 1].expirationTimestamp, sorted[sorted.length - 1]);

  for (let index = 1; index < maxCount - 1; index += 1) {
    const target = sorted[0].daysToExpiry + (index / (maxCount - 1)) * (sorted[sorted.length - 1].daysToExpiry - sorted[0].daysToExpiry);
    const candidate = [...sorted]
      .filter((expiry) => !selected.has(expiry.expirationTimestamp))
      .sort((a, b) => Math.abs(a.daysToExpiry - target) - Math.abs(b.daysToExpiry - target))
      .find((expiry) =>
        Array.from(selected.values()).every((selectedExpiry) => Math.abs(selectedExpiry.daysToExpiry - expiry.daysToExpiry) >= minGapDays)
      );
    if (candidate) selected.set(candidate.expirationTimestamp, candidate);
  }

  if (selected.size < Math.min(maxCount, sorted.length)) {
    for (const expiry of sorted) {
      if (selected.size >= maxCount) break;
      if (!selected.has(expiry.expirationTimestamp)) selected.set(expiry.expirationTimestamp, expiry);
    }
  }

  return Array.from(selected.values()).sort((a, b) => a.daysToExpiry - b.daysToExpiry);
}

function disposeScene(scene: THREE.Scene) {
  scene.traverse((object) => {
    if ("geometry" in object && object.geometry instanceof THREE.BufferGeometry) {
      object.geometry.dispose();
    }
    if ("material" in object) {
      const material = object.material as THREE.Material | THREE.Material[] | undefined;
      const materials = Array.isArray(material) ? material : material ? [material] : [];
      for (const item of materials) {
        if ("map" in item && item.map instanceof THREE.Texture) item.map.dispose();
        item.dispose();
      }
    }
  });
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function percentile(values: number[], percentileValue: number): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * percentileValue)));
  return sorted[index];
}

function minFinite(values: Array<number | null | undefined>): number | null {
  const finiteValues = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finiteValues.length === 0 ? null : Math.min(...finiteValues);
}

function maxFinite(values: Array<number | null | undefined>): number | null {
  const finiteValues = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finiteValues.length === 0 ? null : Math.max(...finiteValues);
}

function formatYieldRange(surface: YieldSurfaceResponse | null): string {
  if (!surface || surface.minAnnualizedYield === null || surface.maxAnnualizedYield === null) return "-";
  return `${formatPct(surface.minAnnualizedYield, 1)} - ${formatPct(surface.maxAnnualizedYield, 1)}`;
}

function formatAge(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return "-";
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  return `${(seconds / 60).toFixed(1)}m`;
}

function Metric({
  label,
  value,
  tone
}: {
  label: string;
  value: React.ReactNode;
  tone?: "status-live" | "status-warn" | "status-stale";
}) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${tone === "status-live" ? "green" : tone === "status-stale" ? "red" : tone === "status-warn" ? "purple" : ""}`}>
        {value}
      </div>
    </div>
  );
}
