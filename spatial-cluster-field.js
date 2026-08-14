(function spatialClusterField(global) {
  "use strict";

  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
  const mix = (start, end, amount) => start + (end - start) * amount;

  function compactAmount(options) {
    if (!options || options.compact !== true) return 0;
    // Packing is automatic and stable; the exposed control below is only the
    // edge-to-edge repulsion interval, never a size multiplier.
    return 0.5;
  }

  function repulsionGapAmount(options) {
    if (!options || options.compact !== true) return 0;
    const percent = Number(options.compactPercent);
    // The mapping UI stays at 0–100, while the engine deliberately supplies
    // ten times that value so the geometry can reach a 1000% internal range.
    return clamp(Number.isFinite(percent) ? percent : 50, 0, 1000) / 100;
  }

  function compactSpacing(options, loose, compactTight) {
    return mix(loose, compactTight, compactAmount(options));
  }

  function minimumShellClearance(options) {
    if (!options || options.compact !== true) return 0.52;
    return mix(0.08, 0.52, repulsionGapAmount(options));
  }

  function repulsionGap(options) {
    if (!options || options.compact !== true) return 0.18;
    return mix(0.04, 0.3, repulsionGapAmount(options));
  }

  function adaptivePreferenceResponse(compactness, pressure) {
    const pressureBoost = 1 + (clamp(pressure, 1, 6) - 1) * 0.08;
    return clamp(compactness * pressureBoost, 0, 1);
  }

  function primaryCarriers(nodes) {
    const primary = nodes.filter((node) => (Number(node.__clusterLevel) || 0) === 0);
    return primary.length ? primary : nodes;
  }

  function sourceOrigin(nodes, repackedCarrierIds = null) {
    const carriers = primaryCarriers(nodes);
    if (!carriers.length) return { x: 0, y: 0, z: 0 };
    const automaticCarriers = carriers.filter((node) => (
      node.clusterLocalPositionLocked !== true
      || Boolean(repackedCarrierIds && repackedCarrierIds.has(node.id))
    ));
    if (automaticCarriers.length !== carriers.length) return { x: 0, y: 0, z: 0 };
    return automaticCarriers.reduce((origin, node) => ({
      x: origin.x + (Number(node.position && node.position.x) || 0) / automaticCarriers.length,
      y: origin.y + (Number(node.position && node.position.y) || 0) / automaticCarriers.length,
      z: origin.z + (Number(node.position && node.position.z) || 0) / automaticCarriers.length
    }), { x: 0, y: 0, z: 0 });
  }

  function effectiveCarrierRadius(node, nestedCarrierByNodeId = null) {
    const nestedCarrier = nestedCarrierByNodeId && nestedCarrierByNodeId.get(node.id);
    if (nestedCarrier) {
      const clearance = Number(nestedCarrier.clearance);
      return Math.max(
        Number(nestedCarrier.minimumRadius) || Number(node.radius) || 0.82,
        nestedCarrier.radius + (Number.isFinite(clearance) ? clearance : 0.34)
      );
    }
    return Number(node.radius) || 0.82;
  }

  function adaptiveContentScale(nodes, nestedCarrierByNodeId, compactness) {
    if (!(compactness > 0)) return 1;
    const carriers = primaryCarriers(nodes);
    if (carriers.length < 2) return 1;
    const origin = sourceOrigin(nodes);
    const radii = carriers.map((node) => effectiveCarrierRadius(node, nestedCarrierByNodeId));
    const maximumRadius = Math.max(0.34, ...radii);
    const naturalAnchorExtent = Math.max(...carriers.map((node) => Math.hypot(
      (Number(node.position && node.position.x) || 0) - origin.x,
      (Number(node.position && node.position.y) || 0) - origin.y,
      ((Number(node.position && node.position.z) || 0) - origin.z) * 0.22
    )));
    if (!(naturalAnchorExtent > 0.0001)) return 1;
    const areaRadius = Math.sqrt(radii.reduce((sum, radius) => sum + radius * radius, 0)) * 1.12;
    const targetAnchorExtent = Math.max(0.18, areaRadius - maximumRadius * 0.72);
    const fittedScale = clamp(targetAnchorExtent / naturalAnchorExtent, 0.08, 1);
    const oversizePressure = clamp(
      (naturalAnchorExtent + maximumRadius) / Math.max(maximumRadius, areaRadius),
      1,
      6
    );
    const adaptiveResponse = adaptivePreferenceResponse(compactness, oversizePressure);
    return mix(1, fittedScale, adaptiveResponse);
  }

  function adaptiveNestedScale(childRadius, motherNode, compactness) {
    if (!(compactness > 0)) return 1;
    const motherRadius = clamp((Number(motherNode && motherNode.radius) || 0.82) * 1.12, 0.34, 0.82);
    const carrierBudget = motherRadius + mix(0.42, 0.14, compactness);
    const fittedScale = clamp(carrierBudget / Math.max(0.001, childRadius), 0.04, 1);
    const oversizePressure = clamp(childRadius / Math.max(0.001, carrierBudget), 1, 6);
    const adaptiveResponse = adaptivePreferenceResponse(compactness, oversizePressure);
    return mix(1, fittedScale, adaptiveResponse);
  }

  function clusterRadius(nodes, nestedCarrierByNodeId = null, optionsInput = {}) {
    const options = optionsInput && typeof optionsInput === "object" ? optionsInput : {};
    const compact = options.compact === true;
    const compactness = compactAmount(options);
    const contentScale = adaptiveContentScale(nodes, nestedCarrierByNodeId, compactness);
    const shellPadding = minimumShellClearance(options);
    const carriers = primaryCarriers(nodes);
    const nodeCount = Math.max(1, carriers.length);
    const maximumRadius = Math.max(
      0.34,
      ...carriers.map((node) => effectiveCarrierRadius(node, nestedCarrierByNodeId))
    );
    const origin = sourceOrigin(nodes);
    const contentExtent = carriers.length
      ? Math.max(...carriers.map((node) => Math.hypot(
          ((Number(node.position && node.position.x) || 0) - origin.x)
            * (node.clusterLocalPositionLocked === true ? 1 : contentScale),
          ((Number(node.position && node.position.y) || 0) - origin.y)
            * (node.clusterLocalPositionLocked === true ? 1 : contentScale),
          ((Number(node.position && node.position.z) || 0) - origin.z) * 0.22
            * (node.clusterLocalPositionLocked === true ? 1 : contentScale)
        ) + effectiveCarrierRadius(node, nestedCarrierByNodeId) + shellPadding))
      : mix(1.25, 0.85, compactness);
    // A lone carrier already describes its complete footprint. Treating it as a
    // packed group multiplies every nested shell and creates large empty rings.
    // Additional packing space now grows only with carriers beyond the first.
    const packingRadius = maximumRadius
      + compactSpacing(options, 0.62, 0.14)
      + maximumRadius * mix(1.48, 0.62, compactness) * Math.sqrt(Math.max(0, nodeCount - 1));
    const gridColumns = Math.ceil(Math.sqrt(nodeCount));
    const gridRows = Math.ceil(nodeCount / gridColumns);
    const gridGap = compact ? repulsionGap(options) : 0.18;
    const gridCell = maximumRadius * 2 + gridGap;
    const gridPackingRadius = Math.hypot(
      Math.max(0, gridColumns - 1) * gridCell / 2,
      Math.max(0, gridRows - 1) * gridCell / 2
    ) + maximumRadius + shellPadding;
    return Math.max(
      compactSpacing(options, 1.25, 0.85),
      contentExtent,
      packingRadius,
      compactness > 0 ? gridPackingRadius : 0
    );
  }

  function stableDirection(firstId, secondId) {
    const text = String(firstId) < String(secondId)
      ? `${firstId}:${secondId}`
      : `${secondId}:${firstId}`;
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const angle = (hash >>> 0) / 4294967296 * Math.PI * 2;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  }

  function clusterNodeScale() {
    return 1;
  }

  function measuredClusterRadius(layoutNodes, optionsInput = {}) {
    const options = optionsInput && typeof optionsInput === "object" ? optionsInput : {};
    const compactness = compactAmount(options);
    const minimumRadius = compactSpacing(options, 1.25, 0.85);
    const shellPadding = minimumShellClearance(options);
    if (!layoutNodes.length) return minimumRadius;
    return Math.max(
      minimumRadius,
      ...layoutNodes.map((node) => (
        Math.hypot(node.position.x, node.position.y, node.position.z)
          + node.__clusterRadius
          + shellPadding
      ))
    );
  }

  function placeLocalLayout(layoutNodes, center, displayScale, ownerPath) {
    return layoutNodes.map((node) => ({
      ...node,
      ownerPath,
      __clusterRadius: node.__clusterRadius * displayScale,
      position: {
        x: center.x + node.position.x * displayScale,
        y: center.y + node.position.y * displayScale,
        z: center.z + node.position.z * displayScale
      }
    }));
  }

  function recenterCompactLayout(layout, center) {
    if (!layout.length || layout.some((node) => node.__packingLocked === true)) return;
    const minimum = { x: Infinity, y: Infinity };
    const maximum = { x: -Infinity, y: -Infinity };
    for (const node of layout) {
      minimum.x = Math.min(minimum.x, node.position.x - node.__clusterRadius);
      maximum.x = Math.max(maximum.x, node.position.x + node.__clusterRadius);
      minimum.y = Math.min(minimum.y, node.position.y - node.__clusterRadius);
      maximum.y = Math.max(maximum.y, node.position.y + node.__clusterRadius);
    }
    const offset = {
      x: (minimum.x + maximum.x) / 2 - center.x,
      y: (minimum.y + maximum.y) / 2 - center.y
    };
    for (const node of layout) {
      node.position.x -= offset.x;
      node.position.y -= offset.y;
    }
  }

  function contractShellToLocalEdges(nodes, center, initialRadius, ownerPath, nestedCarrierByNodeId, options) {
    let radius = initialRadius;
    let layout = [];
    for (let pass = 0; pass < 12; pass += 1) {
      layout = transformedNodes(
        nodes,
        center,
        radius,
        ownerPath,
        nestedCarrierByNodeId,
        options
      );
      if (options.compact === true) recenterCompactLayout(layout, center);
      if (options.compact !== true) break;
      // The measured radius is the maximum of every real node edge plus x.
      // Edges already at x hold the shell; every other direction can shrink.
      const contactedRadius = measuredClusterRadius(layout, options);
      if (contactedRadius >= radius - 0.0005) {
        radius = contactedRadius;
        break;
      }
      radius = contactedRadius;
    }
    return { layout, radius };
  }

  function sceneBoundsForClusters(clusters) {
    if (!clusters.length) {
      return {
        center: { x: 0, y: 0, z: 0 },
        radius: 0,
        minimum: { x: 0, y: 0, z: 0 },
        maximum: { x: 0, y: 0, z: 0 }
      };
    }
    const minimum = { x: Infinity, y: Infinity, z: Infinity };
    const maximum = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const cluster of clusters) {
      for (const axis of ["x", "y", "z"]) {
        minimum[axis] = Math.min(minimum[axis], cluster.center[axis] - cluster.radius);
        maximum[axis] = Math.max(maximum[axis], cluster.center[axis] + cluster.radius);
      }
    }
    const center = {
      x: (minimum.x + maximum.x) / 2,
      y: (minimum.y + maximum.y) / 2,
      z: (minimum.z + maximum.z) / 2
    };
    const radius = Math.max(...clusters.map((cluster) => Math.hypot(
      cluster.center.x - center.x,
      cluster.center.y - center.y,
      cluster.center.z - center.z
    ) + cluster.radius));
    return { center, radius, minimum, maximum };
  }

  function nestedDescendantOf(cluster, anchor, clusterByPath) {
    let current = cluster;
    while (current && current.path !== anchor.path) {
      // A nested shell is carried by the parent node, so it must translate as
      // one rigid local field. Hierarchy and peripheral groups are independent
      // shells and are deliberately left for the repulsion solver.
      if (current.projectionMode !== "nested") return false;
      current = clusterByPath.get(current.parentPath);
    }
    return Boolean(current && current.path === anchor.path);
  }

  function translateCluster(cluster, delta) {
    for (const axis of ["x", "y", "z"]) cluster.center[axis] += delta[axis];
    for (const node of cluster.layoutNodes || []) {
      for (const axis of ["x", "y", "z"]) node.position[axis] += delta[axis];
    }
  }

  function shellOverlapCount(clusters, gap) {
    const clusterByPath = new Map(clusters.map((cluster) => [cluster.path, cluster]));
    const anchors = clusters.filter((cluster) => cluster.projectionMode !== "nested");
    let count = 0;
    for (let leftIndex = 0; leftIndex < anchors.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < anchors.length; rightIndex += 1) {
        const left = anchors[leftIndex];
        const right = anchors[rightIndex];
        if (nestedDescendantOf(left, right, clusterByPath) || nestedDescendantOf(right, left, clusterByPath)) continue;
        const distance = Math.hypot(
          right.center.x - left.center.x,
          right.center.y - left.center.y
        );
        if (distance + 0.00001 < left.radius + right.radius + gap) count += 1;
      }
    }
    return count;
  }

  function repelIndependentShells(clusters, options) {
    const anchors = clusters.filter((cluster) => cluster.projectionMode !== "nested");
    if (anchors.length < 2) return 0;
    const clusterByPath = new Map(clusters.map((cluster) => [cluster.path, cluster]));
    const families = new Map(anchors.map((anchor) => [
      anchor.path,
      clusters.filter((cluster) => nestedDescendantOf(cluster, anchor, clusterByPath))
    ]));
    const gap = repulsionGap(options);

    // This is a hard projection, not a visual zoom: every independent shell is
    // an actual circle collider. Only the two contacted edges move apart; all
    // other geometry stays unchanged until it contacts its own interval.
    for (let iteration = 0; iteration < 640; iteration += 1) {
      let maximumPenetration = 0;
      for (let leftIndex = 0; leftIndex < anchors.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < anchors.length; rightIndex += 1) {
          const left = anchors[leftIndex];
          const right = anchors[rightIndex];
          const dx = right.center.x - left.center.x;
          const dy = right.center.y - left.center.y;
          const distance = Math.hypot(dx, dy);
          const minimumDistance = left.radius + right.radius + gap;
          const penetration = minimumDistance - distance;
          if (!(penetration > 0.000001)) continue;
          const planar = distance > 0.0001
            ? { x: dx / distance, y: dy / distance, z: 0 }
            : { ...stableDirection(left.path, right.path), z: 0 };
          const correction = penetration * 0.505;
          const leftDelta = { x: -planar.x * correction, y: -planar.y * correction, z: -planar.z * correction };
          const rightDelta = { x: planar.x * correction, y: planar.y * correction, z: planar.z * correction };
          for (const member of families.get(left.path)) translateCluster(member, leftDelta);
          for (const member of families.get(right.path)) translateCluster(member, rightDelta);
          maximumPenetration = Math.max(maximumPenetration, penetration);
        }
      }
      if (maximumPenetration <= 0.000001) break;
    }
    return shellOverlapCount(clusters, gap);
  }

  function placeCompactDisk(automaticNodes, fixedNodes, center, gap) {
    const placed = [...fixedNodes];
    const ordered = [...automaticNodes].sort((left, right) => (
      right.__clusterRadius - left.__clusterRadius
      || String(left.id).localeCompare(String(right.id))
    ));
    const fits = (node, candidate) => placed.every((other) => (
      Math.hypot(candidate.x - other.position.x, candidate.y - other.position.y) + 0.00001
        >= node.__clusterRadius + other.__clusterRadius + gap
    ));
    const extentAt = (node, candidate) => Math.hypot(
      candidate.x - center.x,
      candidate.y - center.y
    ) + node.__clusterRadius;

    for (const node of ordered) {
      const candidates = [{ x: center.x, y: center.y }];
      for (const anchor of placed) {
        const tangentDistance = node.__clusterRadius + anchor.__clusterRadius + gap;
        const seed = stableDirection(node.id, anchor.id);
        const startAngle = Math.atan2(seed.y, seed.x);
        for (let step = 0; step < 48; step += 1) {
          const angle = startAngle + step * Math.PI * 2 / 48;
          candidates.push({
            x: anchor.position.x + Math.cos(angle) * tangentDistance,
            y: anchor.position.y + Math.sin(angle) * tangentDistance
          });
        }
      }
      const valid = candidates.filter((candidate) => fits(node, candidate));
      let best = valid.sort((left, right) => (
        extentAt(node, left) - extentAt(node, right)
        || Math.hypot(left.x - center.x, left.y - center.y)
          - Math.hypot(right.x - center.x, right.y - center.y)
        || left.y - right.y
        || left.x - right.x
      ))[0];
      if (!best) {
        const seed = stableDirection(node.id, "compact-disk");
        const startAngle = Math.atan2(seed.y, seed.x);
        const stepSize = Math.max(0.04, gap * 0.5, node.__clusterRadius * 0.12);
        for (let attempt = 1; attempt < 4096; attempt += 1) {
          const distance = stepSize * Math.sqrt(attempt);
          const angle = startAngle + attempt * Math.PI * (3 - Math.sqrt(5));
          const candidate = {
            x: center.x + Math.cos(angle) * distance,
            y: center.y + Math.sin(angle) * distance
          };
          if (!fits(node, candidate)) continue;
          best = candidate;
          break;
        }
      }
      if (best) {
        node.position.x = best.x;
        node.position.y = best.y;
        node.position.z = center.z;
      }
      placed.push(node);
    }
  }

  function transformedNodes(nodes, center, radius, ownerPath, nestedCarrierByNodeId = null, optionsInput = {}) {
    if (!nodes.length) return [];
    const options = optionsInput && typeof optionsInput === "object" ? optionsInput : {};
    const compact = options.compact === true;
    const compactness = compactAmount(options);
    const collisionGap = compact ? repulsionGap(options) : 0.18;
    const contentScale = adaptiveContentScale(nodes, nestedCarrierByNodeId, compactness);
    const displayScale = clamp(Number(options.displayScale) || 1, 0.001, 1);
    const repackedCarrierIds = compact && nestedCarrierByNodeId
      ? new Set(nestedCarrierByNodeId.keys())
      : null;
    const origin = sourceOrigin(nodes, repackedCarrierIds);
    const positioned = nodes.map((node) => {
      const nestedCarrier = nestedCarrierByNodeId && nestedCarrierByNodeId.get(node.id);
      const nestedClearance = nestedCarrier ? Number(nestedCarrier.clearance) : NaN;
      const packingLocked = node.clusterLocalPositionLocked === true
        && !(compact && nestedCarrier);
      const positionScale = packingLocked ? 1 : contentScale;
      return {
        ...node,
        sourceNode: node.sourceNode || node,
        ownerPath,
        __clusterRadius: (nestedCarrier
          ? nestedCarrier.radius + (Number.isFinite(nestedClearance) ? nestedClearance : 0.34)
          : clamp((Number(node.radius) || 0.82) * 1.12, 0.34, 0.82)) * displayScale,
        __nestedCarrierPath: nestedCarrier ? nestedCarrier.path : null,
        __packingLocked: packingLocked,
        position: {
          x: center.x + ((Number(node.position && node.position.x) || 0) - origin.x) * positionScale * displayScale,
          y: center.y + ((Number(node.position && node.position.y) || 0) - origin.y) * positionScale * displayScale,
          z: compact
            ? center.z
            : center.z + ((Number(node.position && node.position.z) || 0) - origin.z) * 0.22 * positionScale * displayScale
        }
      };
    });

    if (compactness > 0 && positioned.length > 1) {
      const automatic = positioned
        .filter((node) => node.__packingLocked !== true)
        .sort((left, right) => String(left.id).localeCompare(String(right.id)));
      const fixed = positioned.filter((node) => node.__packingLocked === true);
      placeCompactDisk(automatic, fixed, center, collisionGap * displayScale);
    }
    const anchors = new Map(positioned.map((node) => [node.id, { ...node.position }]));

    for (let iteration = 0; iteration < 640; iteration += 1) {
      const deltas = new Map(positioned.map((node) => [node.id, { x: 0, y: 0 }]));
      let unsettled = false;
      for (let leftIndex = 0; leftIndex < positioned.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < positioned.length; rightIndex += 1) {
          const left = positioned[leftIndex];
          const right = positioned[rightIndex];
          const dx = right.position.x - left.position.x;
          const dy = right.position.y - left.position.y;
          const distance = Math.hypot(dx, dy);
          const direction = distance > 0.0001
            ? { x: dx / distance, y: dy / distance }
            : stableDirection(left.id, right.id);
          const minimumDistance = left.__clusterRadius + right.__clusterRadius + collisionGap;
          // In A mode repulsion begins exactly at x. A wider influence field
          // recreates the large empty gaps that compact packing is meant to remove.
          const influenceDistance = compact
            ? minimumDistance
            : minimumDistance * mix(1.72, 1.08, compactness);
          if (distance >= influenceDistance) continue;
          const force = (influenceDistance - distance)
            * (distance < minimumDistance ? 0.68 : mix(0.28, 0.08, compactness));
          const bothLocked = left.__packingLocked === true && right.__packingLocked === true;
          const leftLocked = left.__packingLocked === true;
          const rightLocked = right.__packingLocked === true && !bothLocked;
          const leftForce = leftLocked ? 0 : rightLocked ? force * 2 : force;
          const rightForce = rightLocked ? 0 : leftLocked ? force * 2 : force;
          deltas.get(left.id).x -= direction.x * leftForce;
          deltas.get(left.id).y -= direction.y * leftForce;
          deltas.get(right.id).x += direction.x * rightForce;
          deltas.get(right.id).y += direction.y * rightForce;
          unsettled = true;
        }
      }
      for (const node of positioned) {
        if (node.__packingLocked === true) continue;
        const delta = deltas.get(node.id);
        const anchor = anchors.get(node.id);
        delta.x += (anchor.x - node.position.x) * 0.002;
        delta.y += (anchor.y - node.position.y) * 0.002;
        const length = Math.hypot(delta.x, delta.y);
        const step = length > 0.48 ? 0.48 / length : 1;
        node.position.x += delta.x * step;
        node.position.y += delta.y * step;
        const localX = node.position.x - center.x;
        const localY = node.position.y - center.y;
        const localDistance = Math.hypot(localX, localY);
        const boundary = Math.max(0.12, radius - node.__clusterRadius - minimumShellClearance(options));
        if (localDistance > boundary) {
          const scale = boundary / localDistance;
          node.position.x = center.x + localX * scale;
          node.position.y = center.y + localY * scale;
        }
      }
      if (!unsettled) break;
    }

    // Soft forces preserve the source shape, then this deterministic projection
    // enforces the hard geometry contract. It is deliberately independent of
    // content density: every circle pair must be exclusive before rendering.
    const hardGap = collisionGap;
    for (let iteration = 0; iteration < 960; iteration += 1) {
      let maximumPenetration = 0;
      for (let leftIndex = 0; leftIndex < positioned.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < positioned.length; rightIndex += 1) {
          const left = positioned[leftIndex];
          const right = positioned[rightIndex];
          const dx = right.position.x - left.position.x;
          const dy = right.position.y - left.position.y;
          const distance = Math.hypot(dx, dy);
          const minimumDistance = left.__clusterRadius + right.__clusterRadius + hardGap;
          const penetration = minimumDistance - distance;
          if (!(penetration > 0.000001)) continue;
          const direction = distance > 0.0001
            ? { x: dx / distance, y: dy / distance }
            : stableDirection(left.id, right.id);
          const leftLocked = left.__packingLocked === true;
          const rightLocked = right.__packingLocked === true;
          const correction = penetration * (leftLocked || rightLocked ? 1.01 : 0.505);
          if (!leftLocked) {
            left.position.x -= direction.x * correction;
            left.position.y -= direction.y * correction;
          }
          if (!rightLocked) {
            right.position.x += direction.x * correction;
            right.position.y += direction.y * correction;
          }
          maximumPenetration = Math.max(maximumPenetration, penetration);
        }
      }
      for (const node of positioned) {
        if (node.__packingLocked === true) continue;
        const localX = node.position.x - center.x;
        const localY = node.position.y - center.y;
        const localDistance = Math.hypot(localX, localY);
        const boundary = Math.max(0.12, radius - node.__clusterRadius - minimumShellClearance(options));
        if (localDistance > boundary) {
          const scale = boundary / localDistance;
          node.position.x = center.x + localX * scale;
          node.position.y = center.y + localY * scale;
        }
      }
      if (maximumPenetration <= 0.000001) break;
    }

    const hasHardOverlap = () => positioned.some((left, leftIndex) => (
      positioned.slice(leftIndex + 1).some((right) => (
        Math.hypot(
          right.position.x - left.position.x,
          right.position.y - left.position.y
        ) + 0.00001 < left.__clusterRadius + right.__clusterRadius + hardGap
      ))
    ));
    if (hasHardOverlap()) {
      const ordered = [...positioned].sort((left, right) => String(left.id).localeCompare(String(right.id)));
      const maximumRadius = Math.max(...ordered.map((node) => node.__clusterRadius));
      const cell = maximumRadius * 2 + hardGap;
      const placed = [];
      const movable = [];
      const fitsPlaced = (node, x, y) => placed.every((other) => (
        Math.hypot(x - other.position.x, y - other.position.y)
          + 0.00001 >= node.__clusterRadius + other.__clusterRadius + hardGap
      ));
      for (const node of ordered) {
        if (node.__packingLocked === true && fitsPlaced(node, node.position.x, node.position.y)) {
          placed.push(node);
        } else {
          movable.push(node);
        }
      }
      for (const node of movable) {
        if (!fitsPlaced(node, node.position.x, node.position.y)) {
          const baseDirection = stableDirection(node.id, ownerPath);
          const baseAngle = Math.atan2(baseDirection.y, baseDirection.x);
          for (let attempt = 0; attempt < 4096; attempt += 1) {
            const distance = cell * 0.58 * Math.sqrt(attempt);
            const angle = baseAngle + attempt * Math.PI * (3 - Math.sqrt(5));
            const x = center.x + Math.cos(angle) * distance;
            const y = center.y + Math.sin(angle) * distance;
            if (!fitsPlaced(node, x, y)) continue;
            node.position.x = x;
            node.position.y = y;
            node.position.z = center.z;
            break;
          }
        }
        placed.push(node);
      }
    }
    return positioned;
  }

  function buildScene(routeDomainsInput, optionsInput = {}) {
    const routeDomains = Array.isArray(routeDomainsInput) ? routeDomainsInput : [];
    const options = optionsInput && typeof optionsInput === "object" ? optionsInput : {};
    const compact = options.compact === true;
    const compactness = compactAmount(options);
    const peripheralDepthShrinkPercent = clamp(
      Number(options.peripheralDepthShrinkPercent) || 0,
      0,
      90
    );
    const peripheralDepthScale = 1 - peripheralDepthShrinkPercent / 100;
    // Compactness is a content-aware packing preference, not a scene scale.
    // Keeping this marker at one preserves the camera contract for old callers.
    const compressionMultiplier = 1;
    // S is an overview of the opened field, not a performance preview: hiding
    // older domains here makes real nodes disappear while their shells remain.
    const maxDetailedClusters = compact
      ? Math.max(1, routeDomains.length)
      : clamp(Math.floor(Number(options.maxDetailedClusters) || 12), 1, 24);
    const detailedStart = Math.max(0, routeDomains.length - maxDetailedClusters);
    const explicitActive = routeDomains.some((domain) => domain && domain.active === true);
    const prepared = routeDomains.map((domain, index) => {
      const sourceNodes = Array.isArray(domain.nodes) ? domain.nodes : [];
      const depth = Number.isFinite(domain.depth) ? domain.depth : index;
      let parentPath = domain.parentPath || null;
      if (!parentPath && depth > 0) {
        for (let candidateIndex = index - 1; candidateIndex >= 0; candidateIndex -= 1) {
          const candidate = routeDomains[candidateIndex];
          const candidateDepth = Number.isFinite(candidate.depth) ? candidate.depth : candidateIndex;
          if (candidateDepth === depth - 1) {
            parentPath = candidate.path || "root";
            break;
          }
        }
      }
      return {
        domain,
        sourceNodes,
        radius: clusterRadius(sourceNodes, null, {
          compact,
          compactPercent: options.compactPercent
        }),
        nestedCarrierByNodeId: new Map(),
        depth,
        parentPath,
        parentNodeId: domain.parentNodeId || null,
        projectionMode: ["peripheral", "nested"].includes(domain.projectionMode)
          ? domain.projectionMode
          : "hierarchy",
        originalIndex: index,
        lightweight: index < detailedStart,
        active: domain.active === true || (!explicitActive && index === routeDomains.length - 1),
        nestedScale: 1,
        displayScale: 1
      };
    });

    const preparedByPath = new Map(prepared.map((item) => [item.domain.path || "root", item]));
    const solvePreparedLayout = (item) => {
      const path = item.domain.path || "root";
      const layoutOptions = {
        compact,
        compactPercent: options.compactPercent,
        displayScale: 1
      };
      const contracted = contractShellToLocalEdges(
        item.sourceNodes,
        { x: 0, y: 0, z: 0 },
        clusterRadius(item.sourceNodes, item.nestedCarrierByNodeId, layoutOptions),
        path,
        item.nestedCarrierByNodeId,
        layoutOptions
      );
      item.localLayout = contracted.layout;
      item.radius = contracted.radius;
    };
    prepared.forEach(solvePreparedLayout);
    const nestedChildren = prepared
      .filter((item) => item.projectionMode === "nested" && preparedByPath.has(item.parentPath))
      .sort((left, right) => right.depth - left.depth);
    const peripheralChildren = prepared
      .filter((item) => item.projectionMode === "peripheral" && preparedByPath.has(item.parentPath))
      .sort((left, right) => left.depth - right.depth || left.originalIndex - right.originalIndex);
    const nestedDepths = [...new Set(nestedChildren.map((item) => item.depth))]
      .sort((left, right) => right - left);
    for (const depth of nestedDepths) {
      const parentsToSolve = new Set();
      for (const item of nestedChildren.filter((candidate) => candidate.depth === depth)) {
        const parent = preparedByPath.get(item.parentPath);
        const motherNode = parent.sourceNodes.find((node) => node.id === item.parentNodeId) || null;
        item.nestedScale = adaptiveNestedScale(item.radius, motherNode, compactness);
        parent.nestedCarrierByNodeId.set(item.parentNodeId, {
          path: item.domain.path || "root",
          radius: item.radius * item.nestedScale,
          // The hard collision gap already represents x; another carrier moat
          // would double-count the visible edge interval.
          clearance: compact ? 0 : 0.34,
          minimumRadius: Number(motherNode && motherNode.radius) || 0.82
        });
        parentsToSolve.add(parent);
      }
      parentsToSolve.forEach(solvePreparedLayout);
    }

    for (const item of [...prepared].sort((left, right) => left.depth - right.depth || left.originalIndex - right.originalIndex)) {
      const parent = preparedByPath.get(item.parentPath);
      if (compact && item.projectionMode === "nested" && parent) {
        item.displayScale = parent.displayScale * item.nestedScale;
      } else if (item.projectionMode === "peripheral" && parent) {
        item.displayScale = parent.displayScale * peripheralDepthScale;
      } else {
        item.displayScale = 1;
      }
    }

    const layoutItems = prepared.filter((item) => !(
      ["nested", "peripheral"].includes(item.projectionMode)
      && preparedByPath.has(item.parentPath)
    ));
    const layoutSet = new Set(layoutItems);
    const childrenByParent = new Map();
    for (const item of layoutItems) {
      const parent = preparedByPath.get(item.parentPath);
      if (!layoutSet.has(parent)) continue;
      if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
      childrenByParent.get(parent).push(item);
    }
    for (const [parent, children] of childrenByParent.entries()) {
      const origin = sourceOrigin(parent.sourceNodes);
      const nodeX = (item) => {
        const node = parent.sourceNodes.find((candidate) => candidate.id === item.parentNodeId);
        return node ? (Number(node.position && node.position.x) || 0) - origin.x : 0;
      };
      children.sort((left, right) => (
        nodeX(left) - nodeX(right)
        || String(left.domain.path || "").localeCompare(String(right.domain.path || ""))
      ));
    }

    const subtreeSpans = new Map();
    const subtreeSpan = (item, visiting = new Set()) => {
      if (subtreeSpans.has(item)) return subtreeSpans.get(item);
      if (visiting.has(item)) return item.radius * 2 + 1.2;
      visiting.add(item);
      const children = childrenByParent.get(item) || [];
      const childrenWidth = children.reduce((sum, child) => sum + subtreeSpan(child, visiting), 0)
        + Math.max(0, children.length - 1) * 1.8;
      visiting.delete(item);
      const span = Math.max(item.radius * 2 + 1.2, childrenWidth);
      subtreeSpans.set(item, span);
      return span;
    };
    const roots = layoutItems
      .filter((item) => !layoutSet.has(preparedByPath.get(item.parentPath)))
      .sort((left, right) => left.originalIndex - right.originalIndex);
    const centerXByItem = new Map();
    const assignSubtree = (item, centerX) => {
      centerXByItem.set(item, centerX);
      const children = childrenByParent.get(item) || [];
      const total = children.reduce((sum, child) => sum + subtreeSpan(child), 0)
        + Math.max(0, children.length - 1) * 1.8;
      let cursor = centerX - total / 2;
      for (const child of children) {
        const span = subtreeSpan(child);
        assignSubtree(child, cursor + span / 2);
        cursor += span + 1.8;
      }
    };
    const rootWidth = roots.reduce((sum, item) => sum + subtreeSpan(item), 0)
      + Math.max(0, roots.length - 1) * 2.4;
    let rootCursor = -rootWidth / 2;
    for (const root of roots) {
      const span = subtreeSpan(root);
      assignSubtree(root, rootCursor + span / 2);
      rootCursor += span + 2.4;
    }

    const depthItems = new Map();
    for (const item of layoutItems) {
      if (!depthItems.has(item.depth)) depthItems.set(item.depth, []);
      depthItems.get(item.depth).push(item);
    }
    const depths = [...depthItems.keys()].sort((left, right) => left - right);
    const minimumDepth = prepared.length ? Math.min(...prepared.map((item) => item.depth)) : 0;
    const layerY = new Map();
    let previousDepth = null;
    let previousMaximumRadius = 0;
    for (const depth of depths) {
      const maximumRadius = Math.max(...depthItems.get(depth).map((item) => item.radius));
      layerY.set(depth, previousDepth === null
        ? 0
        : layerY.get(previousDepth) - previousMaximumRadius - maximumRadius - 2.2);
      previousDepth = depth;
      previousMaximumRadius = maximumRadius;
    }

    const clusters = [];
    const placedByPath = new Map();
    const createCluster = (item, center) => {
      const path = item.domain.path || "root";
      const displayRadius = item.radius * item.displayScale;
      const layoutNodes = placeLocalLayout(item.localLayout, center, item.displayScale, path);
      const visibleNodes = layoutNodes.filter((node) => !node.__nestedCarrierPath);
      const parentItem = preparedByPath.get(item.parentPath);
      const sourceDetailNode = parentItem
        ? parentItem.sourceNodes.find((node) => node.id === item.parentNodeId) || null
        : null;
      const detailNode = sourceDetailNode
        ? sourceDetailNode.sourceNode || sourceDetailNode
        : null;
      const parentCarrierNode = item.projectionMode === "nested" ? detailNode : null;
      const cluster = {
        path,
        label: item.domain.label || (item.depth ? `第 ${item.depth} 层` : "全域"),
        depth: item.depth,
        parentPath: item.parentPath,
        parentNodeId: item.parentNodeId,
        projectionMode: item.projectionMode,
        active: item.active,
        center,
        radius: displayRadius,
        nodeScale: item.displayScale,
        alpha: item.active ? 0.068 : 0.036,
        lightweight: item.lightweight,
        nodes: item.lightweight ? [] : visibleNodes,
        layoutNodes,
        parentCarrierNode,
        detailNode,
        description: String(item.domain.description || detailNode && detailNode.description || "").trim(),
        nodeCount: visibleNodes.length,
        originalIndex: item.originalIndex
      };
      clusters.push(cluster);
      placedByPath.set(path, cluster);
      return cluster;
    };
    for (const item of [...layoutItems].sort((left, right) => left.depth - right.depth || left.originalIndex - right.originalIndex)) {
      createCluster(item, {
        x: centerXByItem.get(item) || 0,
        y: layerY.get(item.depth) || 0,
        z: (item.depth - minimumDepth) * 0.95
      });
    }
    for (const item of [...nestedChildren].sort((left, right) => left.depth - right.depth || left.originalIndex - right.originalIndex)) {
      const parent = placedByPath.get(item.parentPath);
      if (!parent) continue;
      const mother = parent.layoutNodes.find((node) => node.id === item.parentNodeId);
      createCluster(item, mother ? { ...mother.position } : { ...parent.center });
    }
    for (const item of peripheralChildren) {
      const parent = placedByPath.get(item.parentPath);
      if (!parent) continue;
      const mother = parent.layoutNodes.find((node) => node.id === item.parentNodeId);
      const anchor = mother ? mother.position : parent.center;
      const direction = stableDirection(item.parentNodeId || item.parentPath, item.domain.path || "");
      const displayRadius = item.radius * item.displayScale;
      const distance = displayRadius + (mother ? mother.__clusterRadius : parent.radius) + 0.8;
      createCluster(item, {
        x: anchor.x + direction.x * distance,
        y: anchor.y + direction.y * distance,
        z: anchor.z + 0.35
      });
    }
    const shellOverlapCountAfterRepulsion = repelIndependentShells(clusters, {
      compact,
      compactPercent: options.compactPercent
    });
    clusters.sort((left, right) => left.originalIndex - right.originalIndex);

    const clusterByPath = new Map(clusters.map((cluster) => [cluster.path, cluster]));
    const corridors = [];
    for (const cluster of clusters) {
      if (cluster.depth === minimumDepth || cluster.projectionMode === "nested") continue;
      const parent = clusterByPath.get(cluster.parentPath);
      if (!parent) continue;
      const mother = cluster.parentNodeId
        ? parent.nodes.find((node) => node.id === cluster.parentNodeId)
        : null;
      const anchor = mother ? mother.position : parent.center;
      const delta = {
        x: cluster.center.x - anchor.x,
        y: cluster.center.y - anchor.y,
        z: cluster.center.z - anchor.z
      };
      const length = Math.max(0.000001, Math.hypot(delta.x, delta.y, delta.z));
      const direction = { x: delta.x / length, y: delta.y / length, z: delta.z / length };
      const motherRadius = mother ? mother.__clusterRadius : 0;
      corridors.push({
        kind: "domain-corridor",
        visualOnly: true,
        fromPath: parent.path,
        fromNodeId: cluster.parentNodeId,
        toPath: cluster.path,
        from: {
          x: anchor.x + direction.x * motherRadius,
          y: anchor.y + direction.y * motherRadius,
          z: anchor.z + direction.z * motherRadius
        },
        to: {
          x: cluster.center.x - direction.x * cluster.radius,
          y: cluster.center.y - direction.y * cluster.radius,
          z: cluster.center.z - direction.z * cluster.radius
        }
      });
    }

    // 0–100% selects the content-aware packing target. Above that range,
    // empty shell clearance contracts first; the resulting field is then
    // normalised to the requested overall range. This keeps nested groups
    // close while preserving the advertised 3×–10× scene footprint.
    if (!clusters.length) {
      return {
        clusters,
        corridors,
        compressionMultiplier,
        shellOverlapCount: shellOverlapCountAfterRepulsion,
        bounds: { center: { x: 0, y: 0, z: 0 }, radius: 0 }
      };
    }
    const bounds = sceneBoundsForClusters(clusters);
    const { center, radius, minimum, maximum } = bounds;
    const offset = { x: -center.x, y: -center.y, z: -center.z };
    for (const cluster of clusters) {
      for (const axis of ["x", "y", "z"]) cluster.center[axis] += offset[axis];
      for (const node of cluster.layoutNodes || cluster.nodes) {
        for (const axis of ["x", "y", "z"]) node.position[axis] += offset[axis];
      }
    }
    for (const corridor of corridors) {
      for (const end of [corridor.from, corridor.to]) {
        for (const axis of ["x", "y", "z"]) end[axis] += offset[axis];
      }
    }
    for (const axis of ["x", "y", "z"]) {
      minimum[axis] += offset[axis];
      maximum[axis] += offset[axis];
    }
    return {
      clusters,
      corridors,
      compressionMultiplier,
      shellOverlapCount: shellOverlapCountAfterRepulsion,
      bounds: { center: { x: 0, y: 0, z: 0 }, radius, minimum, maximum }
    };
  }

  global.SpatialClusterField = Object.freeze({ buildScene });
})(window);
