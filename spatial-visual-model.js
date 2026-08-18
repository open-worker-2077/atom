(function exposeSpatialVisualModel(root) {
  'use strict';

  function isNode(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function hasId(node) {
    return isNode(node) && typeof node.id === 'string' && node.id.length > 0;
  }

  function deriveCarrierMode(node) {
    return 'tunnel';
  }

  function toggleNodeSurface(node) {
    node.surfaceVisible = !node.surfaceVisible;
    node.detailMode = node.surfaceVisible ? 'surface' : 'name';
    return node.surfaceVisible;
  }

  function detailModeFor(node) {
    if (node && ['name', 'surface', 'floating'].includes(node.detailMode)) {
      return node.detailMode;
    }
    return node && node.surfaceVisible === true ? 'surface' : 'floating';
  }

  function cycleNodeDetailMode(node) {
    if (!isNode(node)) return 'name';
    var modes = ['name', 'surface', 'floating'];
    var current = detailModeFor(node);
    var next = modes[(modes.indexOf(current) + 1) % modes.length];
    node.detailMode = next;
    node.surfaceVisible = next === 'surface';
    return next;
  }

  function toggleFieldSurfaces(nodes) {
    var existingNodes = Array.isArray(nodes) ? nodes.filter(isNode) : [];
    var nextState = existingNodes.some(function (node) {
      return node.surfaceVisible !== true;
    });

    existingNodes.forEach(function (node) {
      node.surfaceVisible = nextState;
    });

    return nextState;
  }

  function insertionVortexRadius(carrierRadius) {
    var radius = Math.max(0, Number(carrierRadius) || 0);
    return Math.min(12, Math.max(1.4, radius * 0.24), radius * 0.25);
  }

  function toggleFieldChildren(nodes) {
    var tunnels = Array.isArray(nodes) ? nodes.filter(function (node) {
      return isNode(node) && node.hasChildren === true;
    }) : [];
    var revealed = tunnels.some(function (node) {
      return node.revealed !== true;
    });

    tunnels.forEach(function (node) {
      node.revealed = revealed;
    });

    return { revealed: revealed, nodes: tunnels };
  }

  function descendantPortalId(currentPath, targetPath, candidates) {
    if (
      typeof currentPath !== 'string'
      || typeof targetPath !== 'string'
      || !Array.isArray(candidates)
    ) return null;
    var current = currentPath.replace(/\/+$/, '');
    var target = targetPath.replace(/\/+$/, '');
    if (!current || target === current || !target.startsWith(current + '/')) return null;

    var matches = candidates.filter(function (candidate) {
      if (
        !candidate
        || typeof candidate.nodeId !== 'string'
        || !candidate.nodeId
        || typeof candidate.childPath !== 'string'
      ) return false;
      var childPath = candidate.childPath.replace(/\/+$/, '');
      return target === childPath || target.startsWith(childPath + '/');
    });
    matches.sort(function (left, right) {
      return left.childPath.length - right.childPath.length;
    });
    return matches.length ? matches[0].nodeId : null;
  }

  function visiblePortalRelationship(currentPath, relationship, candidates) {
    if (!isNode(relationship) || !isNode(relationship.from) || !isNode(relationship.to)) {
      return null;
    }

    function visibleNodeId(endpoint) {
      if (endpoint.path === currentPath) return endpoint.nodeId;
      return descendantPortalId(currentPath, endpoint.path, candidates);
    }

    var fromId = visibleNodeId(relationship.from);
    var toId = visibleNodeId(relationship.to);
    if (!fromId || !toId || fromId === toId) return null;
    return {
      fromId: fromId,
      toId: toId,
      kind: 'association',
      label: typeof relationship.label === 'string' ? relationship.label : '关联'
    };
  }

  function findNodeById(nodes, id) {
    if (!Array.isArray(nodes) || typeof id !== 'string' || !id) return null;
    var seen = new Set();
    var stack = nodes.slice();

    while (stack.length) {
      var node = stack.shift();
      if (!isNode(node) || seen.has(node)) continue;
      seen.add(node);
      if (node.id === id) return node;
      if (Array.isArray(node.satellites)) stack.push.apply(stack, node.satellites);
    }

    return null;
  }

  function satelliteLineage(id) {
    if (typeof id !== 'string' || !id) return null;
    var marker = id.indexOf(':sat-');
    if (marker === -1) return { rootId: id, indexes: [] };

    var rootId = id.slice(0, marker);
    var suffix = id.slice(marker);
    var indexes = [];
    var expression = /:sat-(\d+)/g;
    var rebuilt = '';
    var match;

    while ((match = expression.exec(suffix)) !== null) {
      indexes.push(Number(match[1]));
      rebuilt += match[0];
      if (indexes.length > 16) return null;
    }

    if (!rootId || rebuilt !== suffix) return null;
    return { rootId: rootId, indexes: indexes };
  }

  function hydrateNodePath(nodes, id, ensureChildren, options) {
    var lineage = satelliteLineage(id);
    if (!lineage) return null;
    var current = findNodeById(nodes, lineage.rootId);
    var revealAncestors = Boolean(options && options.revealAncestors);
    if (!current || typeof ensureChildren !== 'function') {
      return lineage.indexes.length ? null : current;
    }

    for (var index = 0; index < lineage.indexes.length; index += 1) {
      if (current.hasChildren !== true) return null;
      if (revealAncestors) current.revealed = true;
      var children = ensureChildren(current);
      if (!Array.isArray(children)) return null;
      var childId = current.id + ':sat-' + lineage.indexes[index];
      current = children.find(function (candidate) {
        return isNode(candidate) && candidate.id === childId;
      }) || null;
      if (!current) return null;
    }

    return current;
  }

  function restoreRevealedNodes(nodes, revealedIds, ensureChildren, limit) {
    var budget = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 44;
    var ids = Array.isArray(revealedIds)
      ? Array.from(new Set(revealedIds.filter(function (id) {
        return typeof id === 'string' && id.length > 0;
      }))).slice(0, budget)
      : [];

    ids.sort(function (left, right) {
      return (left.match(/:sat-/g) || []).length - (right.match(/:sat-/g) || []).length;
    });

    return ids.reduce(function (restored, id) {
      var node = hydrateNodePath(nodes, id, ensureChildren, { revealAncestors: false });
      if (!node || node.hasChildren !== true) return restored;
      node.revealed = true;
      ensureChildren(node);
      restored.push(node);
      return restored;
    }, []);
  }

  function resetSnapshotNodeState(nodes) {
    var seen = new Set();
    var stack = Array.isArray(nodes) ? nodes.slice() : [];
    var count = 0;

    while (stack.length) {
      var node = stack.shift();
      if (!isNode(node) || seen.has(node)) continue;
      seen.add(node);
      count += 1;
      node.revealed = false;
      node.peekOpen = false;
      node.lensOpen = false;
      node.lensOpenedAt = 0;
      node.surfaceVisible = false;
      node.surfaceOpenedAt = 0;
      if (Array.isArray(node.satellites)) stack.push.apply(stack, node.satellites);
    }

    return count;
  }

  function relationshipPairs(nodes) {
    var collected = [];
    var seenNodes = new Set();

    function collect(node) {
      if (!isNode(node) || seenNodes.has(node)) return;
      seenNodes.add(node);
      collected.push(node);

      if (Array.isArray(node.satellites)) {
        node.satellites.forEach(collect);
      }
    }

    if (Array.isArray(nodes)) nodes.forEach(collect);

    var nodesById = new Map();
    collected.forEach(function (node) {
      if (hasId(node) && !nodesById.has(node.id)) nodesById.set(node.id, node);
    });

    var pairs = new Map();

    function pairKey(firstId, secondId) {
      return firstId < secondId ? firstId + '\u0000' + secondId : secondId + '\u0000' + firstId;
    }

    function parentIdFor(node) {
      if (typeof node.parent === 'string') return node.parent;
      if (hasId(node.parent)) return node.parent.id;
      return null;
    }

    collected.forEach(function (node) {
      if (!hasId(node)) return;
      var parentId = parentIdFor(node);
      if (!parentId || parentId === node.id || !nodesById.has(parentId)) return;
      var key = pairKey(parentId, node.id);
      if (!pairs.has(key)) {
        pairs.set(key, { fromId: parentId, toId: node.id, kind: 'hierarchy', label: '子节点' });
      }
    });

    collected.forEach(function (node) {
      if (!hasId(node) || !Array.isArray(node.visualLinks)) return;
      node.visualLinks.forEach(function (targetId) {
        if (typeof targetId !== 'string' || targetId === node.id || !nodesById.has(targetId)) return;
        var key = pairKey(node.id, targetId);
        if (!pairs.has(key)) {
          var target = nodesById.get(targetId);
          var sourceParentId = parentIdFor(node);
          var targetParentId = parentIdFor(target);
          var label = sourceParentId && sourceParentId === targetParentId ? '同层' : '关联';
          pairs.set(key, { fromId: node.id, toId: targetId, kind: 'association', label: label });
        }
      });
    });

    return Array.from(pairs.values());
  }

  function nodeLineage(node) {
    if (!isNode(node)) return [];
    var lineage = [];
    var seen = new Set();
    var current = node;

    while (isNode(current) && !seen.has(current) && lineage.length < 16) {
      seen.add(current);
      lineage.push(current);
      current = isNode(current.parent) ? current.parent : null;
    }

    return lineage.reverse();
  }

  function relaxRelationshipLayout(entries, relationships, options) {
    var settings = options || {};
    var iterations = Number.isFinite(settings.iterations)
      ? Math.max(1, Math.min(32, Math.floor(settings.iterations)))
      : 18;
    var baseGap = Number.isFinite(settings.baseGap) ? settings.baseGap : 0.82;
    var radiusScale = Number.isFinite(settings.radiusScale) ? settings.radiusScale : 1.34;
    var repulsionRangeScale = Number.isFinite(settings.repulsionRangeScale)
      ? settings.repulsionRangeScale
      : 1.16;
    var repulsionStrength = Number.isFinite(settings.repulsionStrength)
      ? settings.repulsionStrength
      : 0.38;
    var fieldRepulsionStrength = Number.isFinite(settings.fieldRepulsionStrength)
      ? Math.max(0, settings.fieldRepulsionStrength)
      : 0.11;
    var linkStrength = Number.isFinite(settings.linkStrength) ? settings.linkStrength : 0.16;
    var edgeRepulsionStrength = Number.isFinite(settings.edgeRepulsionStrength)
      ? Math.max(0, settings.edgeRepulsionStrength)
      : 0.34;
    var nodeEdgeRepulsionStrength = Number.isFinite(settings.nodeEdgeRepulsionStrength)
      ? Math.max(0, settings.nodeEdgeRepulsionStrength)
      : 0.34;
    var anchorStrength = Number.isFinite(settings.anchorStrength) ? settings.anchorStrength : 0.055;
    var maxStep = Number.isFinite(settings.maxStep) ? settings.maxStep : 0.42;
    var maxFieldRadius = Number.isFinite(settings.maxFieldRadius) ? settings.maxFieldRadius : 10.8;
    var planarRepulsion = settings.planarRepulsion === true;
    var sourceEntries = Array.isArray(entries) ? entries.filter(function (entry) {
      return isNode(entry)
        && typeof entry.id === 'string'
        && entry.id.length > 0
        && isNode(entry.position)
        && Number.isFinite(entry.position.x)
        && Number.isFinite(entry.position.y)
        && Number.isFinite(entry.position.z);
    }) : [];
    var byId = new Map();
    var positions = {};
    var anchors = {};

    sourceEntries.forEach(function (entry) {
      var normalized = {
        id: entry.id,
        radius: Number.isFinite(entry.radius) ? Math.max(0.05, entry.radius) : 0.5,
        labelSpan: Number.isFinite(entry.labelSpan) ? Math.max(0, entry.labelSpan) : 0,
        fixed: entry.fixed === true,
        parentId: typeof entry.parentId === 'string' ? entry.parentId : null,
        containerRadius: Number.isFinite(entry.containerRadius)
          ? Math.max(0.05, entry.containerRadius)
          : null
      };
      var position = {
        x: entry.position.x,
        y: entry.position.y,
        z: entry.position.z
      };
      byId.set(entry.id, normalized);
      positions[entry.id] = position;
      anchors[entry.id] = { x: position.x, y: position.y, z: position.z };
    });

    function addDelta(deltas, id, direction, amount) {
      var entry = byId.get(id);
      if (!entry || entry.fixed || !Number.isFinite(amount) || amount === 0) return;
      deltas[id].x += direction.x * amount;
      deltas[id].y += direction.y * amount;
      deltas[id].z += direction.z * amount;
    }

    function deterministicDirection(firstId, secondId) {
      var text = firstId < secondId ? firstId + ':' + secondId : secondId + ':' + firstId;
      var hash = 2166136261;
      for (var index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      var angle = (hash % 6283) / 1000;
      var z = (((hash >>> 16) % 701) / 1000) - 0.35;
      var planar = Math.sqrt(Math.max(0.01, 1 - z * z));
      return { x: Math.cos(angle) * planar, y: Math.sin(angle) * planar, z: z };
    }

    function planarDirection(firstId, secondId) {
      var direction = deterministicDirection(firstId, secondId);
      var length = Math.max(0.0001, Math.hypot(direction.x, direction.y));
      return { x: direction.x / length, y: direction.y / length, z: 0 };
    }

    function vectorBetween(firstId, secondId) {
      var first = positions[firstId];
      var second = positions[secondId];
      var delta = {
        x: second.x - first.x,
        y: second.y - first.y,
        z: second.z - first.z
      };
      var distance = Math.hypot(delta.x, delta.y, delta.z);
      if (distance < 0.0001) {
        return { direction: deterministicDirection(firstId, secondId), distance: 0.0001 };
      }
      return {
        direction: { x: delta.x / distance, y: delta.y / distance, z: delta.z / distance },
        distance: distance
      };
    }

    function repulsionVectorBetween(firstId, secondId) {
      if (!planarRepulsion) return vectorBetween(firstId, secondId);
      var first = positions[firstId];
      var second = positions[secondId];
      var delta = { x: second.x - first.x, y: second.y - first.y, z: 0 };
      var distance = Math.hypot(delta.x, delta.y);
      if (distance < 0.0001) {
        return { direction: planarDirection(firstId, secondId), distance: 0.0001 };
      }
      return {
        direction: { x: delta.x / distance, y: delta.y / distance, z: 0 },
        distance: distance
      };
    }

    function forceGroup(entry) {
      return entry && entry.parentId ? entry.parentId : '__root__';
    }

    function linkForceGroup(link) {
      var fromEntry = link && byId.get(link.fromId);
      var toEntry = link && byId.get(link.toId);
      if (!fromEntry || !toEntry) return null;
      var fromGroup = forceGroup(fromEntry);
      return fromGroup === forceGroup(toEntry) ? fromGroup : null;
    }

    function planarOrientation(a, b, c) {
      return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    }

    function linksCross(first, second) {
      if (
        first.fromId === second.fromId || first.fromId === second.toId
        || first.toId === second.fromId || first.toId === second.toId
      ) return false;
      var a = positions[first.fromId];
      var b = positions[first.toId];
      var c = positions[second.fromId];
      var d = positions[second.toId];
      return planarOrientation(a, b, c) * planarOrientation(a, b, d) < 0
        && planarOrientation(c, d, a) * planarOrientation(c, d, b) < 0;
    }

    var links = Array.isArray(relationships) ? relationships.filter(function (relationship) {
      return isNode(relationship)
        && byId.has(relationship.fromId)
        && byId.has(relationship.toId)
        && relationship.fromId !== relationship.toId;
    }) : [];
    var ids = sourceEntries.map(function (entry) { return entry.id; });
    var topologySeeded = new Set();

    function seedSimpleTopologies() {
      var groups = new Map();
      ids.forEach(function (id) {
        var entry = byId.get(id);
        var groupKey = entry.parentId || '__root__';
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey).push(id);
      });

      groups.forEach(function (groupIds, groupKey) {
        var groupSet = new Set(groupIds);
        var associationLinks = links.filter(function (relationship) {
          return relationship.kind !== 'hierarchy'
            && groupSet.has(relationship.fromId)
            && groupSet.has(relationship.toId);
        });
        var adjacency = new Map(groupIds.map(function (id) { return [id, []]; }));
        associationLinks.forEach(function (relationship) {
          adjacency.get(relationship.fromId).push(relationship.toId);
          adjacency.get(relationship.toId).push(relationship.fromId);
        });
        var remaining = new Set(groupIds);

        while (remaining.size) {
          var firstId = Array.from(remaining).sort()[0];
          var component = [];
          var queue = [firstId];
          remaining.delete(firstId);
          while (queue.length) {
            var currentId = queue.shift();
            component.push(currentId);
            adjacency.get(currentId).forEach(function (neighborId) {
              if (!remaining.has(neighborId)) return;
              remaining.delete(neighborId);
              queue.push(neighborId);
            });
          }
          var componentSet = new Set(component);
          var edgeCount = associationLinks.filter(function (relationship) {
            return componentSet.has(relationship.fromId) && componentSet.has(relationship.toId);
          }).length;
          if (component.length === 2 && edgeCount === 1) {
            var pairOrder = component.slice().sort();
            var pairCentre = pairOrder.reduce(function (sum, id) {
              sum.x += anchors[id].x / 2;
              sum.y += anchors[id].y / 2;
              sum.z += anchors[id].z / 2;
              return sum;
            }, { x: 0, y: 0, z: 0 });
            var pairVector = {
              x: anchors[pairOrder[1]].x - anchors[pairOrder[0]].x,
              y: anchors[pairOrder[1]].y - anchors[pairOrder[0]].y,
              z: planarRepulsion ? 0 : anchors[pairOrder[1]].z - anchors[pairOrder[0]].z
            };
            var pairDistance = Math.hypot(pairVector.x, pairVector.y, pairVector.z);
            var pairAxis = pairDistance > 0.5
              ? {
                  x: pairVector.x / pairDistance,
                  y: pairVector.y / pairDistance,
                  z: pairVector.z / pairDistance
                }
              : planarRepulsion
                ? planarDirection(pairOrder[0], pairOrder[1])
                : deterministicDirection(pairOrder[0], pairOrder[1]);
            var pairContainerRadius = byId.get(pairOrder[0]).containerRadius;
            var pairHalfSpan = Number.isFinite(pairContainerRadius)
              ? Math.max(0.08, pairContainerRadius * 0.44)
              : Math.max(
                  2.25,
                  (byId.get(pairOrder[0]).radius + byId.get(pairOrder[1]).radius) * 1.55,
                  (byId.get(pairOrder[0]).labelSpan + byId.get(pairOrder[1]).labelSpan) * 0.58
                );
            pairOrder.forEach(function (id, index) {
              if (byId.get(id).fixed) return;
              var direction = index === 0 ? -1 : 1;
              positions[id] = {
                x: pairCentre.x + pairAxis.x * pairHalfSpan * direction,
                y: pairCentre.y + pairAxis.y * pairHalfSpan * direction,
                z: pairCentre.z + pairAxis.z * pairHalfSpan * direction
              };
              anchors[id] = { x: positions[id].x, y: positions[id].y, z: positions[id].z };
              topologySeeded.add(id);
            });
            continue;
          }
          if (component.length < 3) continue;

          var endpoints = component.filter(function (id) { return adjacency.get(id).length === 1; });
          var simplePath = edgeCount === component.length - 1
            && endpoints.length === 2
            && component.every(function (id) { return adjacency.get(id).length <= 2; });
          var simpleCycle = edgeCount === component.length
            && component.every(function (id) { return adjacency.get(id).length === 2; });
          var unicyclic = edgeCount === component.length;
          if (!simplePath && !unicyclic) continue;

          var cycleCore = null;
          if (unicyclic) {
            cycleCore = new Set(component);
            var cycleDegrees = new Map(component.map(function (id) {
              return [id, adjacency.get(id).filter(function (neighborId) {
                return componentSet.has(neighborId);
              }).length];
            }));
            var leafQueue = component.filter(function (id) { return cycleDegrees.get(id) <= 1; });
            while (leafQueue.length) {
              var leafId = leafQueue.shift();
              if (!cycleCore.has(leafId)) continue;
              cycleCore.delete(leafId);
              adjacency.get(leafId).forEach(function (neighborId) {
                if (!cycleCore.has(neighborId)) return;
                cycleDegrees.set(neighborId, cycleDegrees.get(neighborId) - 1);
                if (cycleDegrees.get(neighborId) === 1) leafQueue.push(neighborId);
              });
            }
            if (cycleCore.size < 3) continue;
          }

          var order = [];
          var orderedSet = simplePath ? componentSet : cycleCore;
          var startId = simplePath ? endpoints.sort()[0] : Array.from(cycleCore).sort()[0];
          var previousId = null;
          var activeId = startId;
          while (activeId && order.length < orderedSet.size) {
            order.push(activeId);
            var candidates = adjacency.get(activeId)
              .filter(function (id) {
                return orderedSet.has(id) && id !== previousId && !order.includes(id);
              })
              .sort();
            previousId = activeId;
            activeId = candidates[0] || null;
          }
          if (order.length !== orderedSet.size) continue;

          var parentPosition = groupKey !== '__root__' && positions[groupKey]
            ? positions[groupKey]
            : null;
          var centre = parentPosition
            ? { x: parentPosition.x, y: parentPosition.y, z: parentPosition.z }
            : component.reduce(function (sum, id) {
                sum.x += anchors[id].x / component.length;
                sum.y += anchors[id].y / component.length;
                sum.z += anchors[id].z / component.length;
                return sum;
              }, { x: 0, y: 0, z: 0 });
          var containerRadius = byId.get(order[0]).containerRadius;

          if (simplePath) {
            var endpointVector = {
              x: anchors[order[order.length - 1]].x - anchors[order[0]].x,
              y: anchors[order[order.length - 1]].y - anchors[order[0]].y,
              z: planarRepulsion ? 0 : anchors[order[order.length - 1]].z - anchors[order[0]].z
            };
            var endpointDistance = Math.hypot(endpointVector.x, endpointVector.y, endpointVector.z);
            var axis = endpointDistance > 0.5
              ? {
                  x: endpointVector.x / endpointDistance,
                  y: endpointVector.y / endpointDistance,
                  z: endpointVector.z / endpointDistance
                }
              : planarRepulsion
                ? planarDirection(order[0], order[order.length - 1])
                : deterministicDirection(order[0], order[order.length - 1]);
            var pathStep = 1.05;
            for (var pathIndex = 1; pathIndex < order.length; pathIndex += 1) {
              var previousEntry = byId.get(order[pathIndex - 1]);
              var currentEntry = byId.get(order[pathIndex]);
              pathStep = Math.max(
                pathStep,
                (previousEntry.radius + currentEntry.radius) * 1.4
                  + (previousEntry.labelSpan + currentEntry.labelSpan) * 0.46
              );
            }
            var halfSpan = Number.isFinite(containerRadius)
              ? containerRadius * 0.88
              : Math.max(2.8, (order.length - 1) * pathStep * 0.5);
            order.forEach(function (id, index) {
              if (byId.get(id).fixed) return;
              var offset = -halfSpan + index * (halfSpan * 2 / (order.length - 1));
              positions[id] = {
                x: centre.x + axis.x * offset,
                y: centre.y + axis.y * offset,
                z: centre.z + axis.z * offset
              };
              anchors[id] = { x: positions[id].x, y: positions[id].y, z: positions[id].z };
              topologySeeded.add(id);
            });
          } else {
            var ringRadius = Number.isFinite(containerRadius)
              ? containerRadius * 0.46
              : Math.max(
                  2.2,
                  order.length * 0.55,
                  Math.max.apply(null, order.map(function (id) {
                    return byId.get(id).labelSpan;
                  })) * 1.08
                );
            var axisU = planarRepulsion
              ? planarDirection(order[0], order[1])
              : deterministicDirection(order[0], order[1]);
            var reference = Math.abs(axisU.z) < 0.82
              ? { x: 0, y: 0, z: 1 }
              : { x: 0, y: 1, z: 0 };
            var axisVRaw = {
              x: axisU.y * reference.z - axisU.z * reference.y,
              y: axisU.z * reference.x - axisU.x * reference.z,
              z: axisU.x * reference.y - axisU.y * reference.x
            };
            var axisVLength = Math.hypot(axisVRaw.x, axisVRaw.y, axisVRaw.z);
            var axisV = {
              x: axisVRaw.x / axisVLength,
              y: axisVRaw.y / axisVLength,
              z: axisVRaw.z / axisVLength
            };
            order.forEach(function (id, index) {
              if (byId.get(id).fixed) return;
              var angle = index / order.length * Math.PI * 2;
              positions[id] = {
                x: centre.x + (axisU.x * Math.cos(angle) + axisV.x * Math.sin(angle)) * ringRadius,
                y: centre.y + (axisU.y * Math.cos(angle) + axisV.y * Math.sin(angle)) * ringRadius,
                z: centre.z + (axisU.z * Math.cos(angle) + axisV.z * Math.sin(angle)) * ringRadius
              };
              anchors[id] = { x: positions[id].x, y: positions[id].y, z: positions[id].z };
              topologySeeded.add(id);
            });

            var branchVisited = new Set(order);
            var branchStep = Number.isFinite(containerRadius)
              ? Math.max(0.08, (containerRadius - ringRadius) * 0.32)
              : 2.1;
            var seedBranch = function (parentId, branchId, direction, tangent, depth) {
              if (branchVisited.has(branchId)) return;
              branchVisited.add(branchId);
              var parentPoint = positions[parentId];
              positions[branchId] = {
                x: parentPoint.x + direction.x * branchStep,
                y: parentPoint.y + direction.y * branchStep,
                z: parentPoint.z + direction.z * branchStep
              };
              anchors[branchId] = {
                x: positions[branchId].x,
                y: positions[branchId].y,
                z: positions[branchId].z
              };
              topologySeeded.add(branchId);
              var children = adjacency.get(branchId)
                .filter(function (id) { return id !== parentId && !branchVisited.has(id); })
                .sort();
              children.forEach(function (childId, childIndex) {
                var spread = (childIndex - (children.length - 1) / 2) * 0.34;
                var childDirectionRaw = {
                  x: direction.x + tangent.x * spread,
                  y: direction.y + tangent.y * spread,
                  z: direction.z + tangent.z * spread
                };
                var childDirectionLength = Math.hypot(
                  childDirectionRaw.x,
                  childDirectionRaw.y,
                  childDirectionRaw.z
                );
                seedBranch(branchId, childId, {
                  x: childDirectionRaw.x / childDirectionLength,
                  y: childDirectionRaw.y / childDirectionLength,
                  z: childDirectionRaw.z / childDirectionLength
                }, tangent, depth + 1);
              });
            };

            order.forEach(function (cycleId) {
              var cyclePoint = positions[cycleId];
              var radial = {
                x: (cyclePoint.x - centre.x) / ringRadius,
                y: (cyclePoint.y - centre.y) / ringRadius,
                z: (cyclePoint.z - centre.z) / ringRadius
              };
              var tangent = {
                x: -axisU.x * Math.sin(order.indexOf(cycleId) / order.length * Math.PI * 2)
                  + axisV.x * Math.cos(order.indexOf(cycleId) / order.length * Math.PI * 2),
                y: -axisU.y * Math.sin(order.indexOf(cycleId) / order.length * Math.PI * 2)
                  + axisV.y * Math.cos(order.indexOf(cycleId) / order.length * Math.PI * 2),
                z: -axisU.z * Math.sin(order.indexOf(cycleId) / order.length * Math.PI * 2)
                  + axisV.z * Math.cos(order.indexOf(cycleId) / order.length * Math.PI * 2)
              };
              var branches = adjacency.get(cycleId)
                .filter(function (id) { return !cycleCore.has(id); })
                .sort();
              branches.forEach(function (branchId, branchIndex) {
                var spread = (branchIndex - (branches.length - 1) / 2) * 0.38;
                var directionRaw = {
                  x: radial.x + tangent.x * spread,
                  y: radial.y + tangent.y * spread,
                  z: radial.z + tangent.z * spread
                };
                var directionLength = Math.hypot(directionRaw.x, directionRaw.y, directionRaw.z);
                seedBranch(cycleId, branchId, {
                  x: directionRaw.x / directionLength,
                  y: directionRaw.y / directionLength,
                  z: directionRaw.z / directionLength
                }, tangent, 1);
              });
            });
          }
        }
      });
    }

    seedSimpleTopologies();

    for (var iteration = 0; iteration < iterations; iteration += 1) {
      var deltas = {};
      ids.forEach(function (id) {
        deltas[id] = { x: 0, y: 0, z: 0 };
      });

      for (var leftIndex = 0; leftIndex < ids.length; leftIndex += 1) {
        for (var rightIndex = leftIndex + 1; rightIndex < ids.length; rightIndex += 1) {
          var leftId = ids[leftIndex];
          var rightId = ids[rightIndex];
          var leftEntry = byId.get(leftId);
          var rightEntry = byId.get(rightId);
          if (forceGroup(leftEntry) !== forceGroup(rightEntry)) continue;
          var separation = repulsionVectorBetween(leftId, rightId);
          var minimumDistance = (leftEntry.radius + rightEntry.radius) * radiusScale
            + baseGap
            + (leftEntry.labelSpan + rightEntry.labelSpan) * 0.42;
          var repulsionRange = minimumDistance * repulsionRangeScale;
          var movableCount = Number(!leftEntry.fixed) + Number(!rightEntry.fixed);
          if (!movableCount) continue;
          var nearRepulsion = separation.distance < repulsionRange
            ? (repulsionRange - separation.distance) * repulsionStrength
            : 0;
          var fieldRepulsion = minimumDistance * minimumDistance
            / (separation.distance * separation.distance + minimumDistance * minimumDistance)
            * fieldRepulsionStrength;
          var repulsion = (nearRepulsion + fieldRepulsion) / movableCount;
          addDelta(deltas, leftId, separation.direction, -repulsion);
          addDelta(deltas, rightId, separation.direction, repulsion);
        }
      }

      links.forEach(function (relationship) {
        var fromEntry = byId.get(relationship.fromId);
        var toEntry = byId.get(relationship.toId);
        if (
          relationship.kind === 'hierarchy'
          || forceGroup(fromEntry) !== forceGroup(toEntry)
        ) return;
        var separation = vectorBetween(relationship.fromId, relationship.toId);
        var radiusDistance = (fromEntry.radius + toEntry.radius) * 1.55;
        var restDistance = Math.max(
          radiusDistance + 1.4,
          3.65,
          radiusDistance + (fromEntry.labelSpan + toEntry.labelSpan) * 0.46
        );
        var movableCount = Number(!fromEntry.fixed) + Number(!toEntry.fixed);
        if (!movableCount) return;
        var pull = (separation.distance - restDistance) * linkStrength / movableCount;
        addDelta(deltas, relationship.fromId, separation.direction, pull);
        addDelta(deltas, relationship.toId, separation.direction, -pull);
      });

      links.forEach(function (relationship) {
        if (relationship.kind === 'hierarchy') return;
        var fromEntry = byId.get(relationship.fromId);
        var toEntry = byId.get(relationship.toId);
        var linkGroup = linkForceGroup(relationship);
        if (!linkGroup) return;
        var fromPosition = positions[relationship.fromId];
        var toPosition = positions[relationship.toId];
        var linkX = toPosition.x - fromPosition.x;
        var linkY = toPosition.y - fromPosition.y;
        var linkLengthSquared = linkX * linkX + linkY * linkY;
        if (linkLengthSquared < 0.0001) return;

        ids.forEach(function (nodeId) {
          if (nodeId === relationship.fromId || nodeId === relationship.toId) return;
          var nodeEntry = byId.get(nodeId);
          if (forceGroup(nodeEntry) !== linkGroup) return;
          var nodePosition = positions[nodeId];
          var projection = Math.max(0.08, Math.min(0.92, (
            (nodePosition.x - fromPosition.x) * linkX
            + (nodePosition.y - fromPosition.y) * linkY
          ) / linkLengthSquared));
          var closest = {
            x: fromPosition.x + linkX * projection,
            y: fromPosition.y + linkY * projection
          };
          var offsetX = nodePosition.x - closest.x;
          var offsetY = nodePosition.y - closest.y;
          var offsetDistance = Math.hypot(offsetX, offsetY);
          var clearance = nodeEntry.radius * radiusScale
            + Math.min(fromEntry.radius, toEntry.radius) * 0.5
            + baseGap * 0.55;
          if (offsetDistance >= clearance) return;
          var normal;
          if (offsetDistance < 0.0001) {
            var linkLength = Math.sqrt(linkLengthSquared);
            var normalSign = deterministicDirection(
              nodeId,
              relationship.fromId + ':' + relationship.toId
            ).x < 0 ? -1 : 1;
            normal = {
              x: -linkY / linkLength * normalSign,
              y: linkX / linkLength * normalSign,
              z: 0
            };
          } else {
            normal = { x: offsetX / offsetDistance, y: offsetY / offsetDistance, z: 0 };
          }
          var force = (clearance - offsetDistance) * nodeEdgeRepulsionStrength;
          addDelta(deltas, nodeId, normal, force * 0.72);
          addDelta(deltas, relationship.fromId, normal, -force * (1 - projection) * 0.28);
          addDelta(deltas, relationship.toId, normal, -force * projection * 0.28);
        });
      });

      for (var firstLinkIndex = 0; firstLinkIndex < links.length; firstLinkIndex += 1) {
        for (var secondLinkIndex = firstLinkIndex + 1; secondLinkIndex < links.length; secondLinkIndex += 1) {
          var firstLink = links[firstLinkIndex];
          var secondLink = links[secondLinkIndex];
          var firstLinkGroup = linkForceGroup(firstLink);
          if (!firstLinkGroup || firstLinkGroup !== linkForceGroup(secondLink)) continue;
          if (!linksCross(firstLink, secondLink)) continue;
          var firstVector = vectorBetween(firstLink.fromId, firstLink.toId).direction;
          var normal = { x: -firstVector.y, y: firstVector.x, z: 0 };
          var sign = deterministicDirection(
            firstLink.fromId + ':' + firstLink.toId,
            secondLink.fromId + ':' + secondLink.toId
          ).x < 0 ? -1 : 1;
          for (const id of [firstLink.fromId, firstLink.toId]) {
            addDelta(deltas, id, normal, edgeRepulsionStrength * sign);
          }
          for (const id of [secondLink.fromId, secondLink.toId]) {
            addDelta(deltas, id, normal, -edgeRepulsionStrength * sign);
          }
        }
      }

      ids.forEach(function (id) {
        var entry = byId.get(id);
        var position = positions[id];
        if (!entry.fixed) {
          var anchor = anchors[id];
          var activeAnchorStrength = topologySeeded.has(id) ? Math.max(anchorStrength, 0.16) : anchorStrength;
          deltas[id].x += (anchor.x - position.x) * activeAnchorStrength;
          deltas[id].y += (anchor.y - position.y) * activeAnchorStrength;
          deltas[id].z += (anchor.z - position.z) * activeAnchorStrength;
          var deltaLength = Math.hypot(deltas[id].x, deltas[id].y, deltas[id].z);
          var stepScale = deltaLength > maxStep ? maxStep / deltaLength : 1;
          position.x += deltas[id].x * stepScale;
          position.y += deltas[id].y * stepScale;
          position.z += deltas[id].z * stepScale;
        }
        var fieldDistance = Math.hypot(position.x, position.y, position.z);
        if (fieldDistance > maxFieldRadius) {
          var fieldScale = maxFieldRadius / fieldDistance;
          position.x *= fieldScale;
          position.y *= fieldScale;
          position.z *= fieldScale;
        }
        if (entry.parentId && positions[entry.parentId] && Number.isFinite(entry.containerRadius)) {
          var parentPosition = positions[entry.parentId];
          var localX = position.x - parentPosition.x;
          var localY = position.y - parentPosition.y;
          var localZ = position.z - parentPosition.z;
          var localDistance = Math.hypot(localX, localY, localZ);
          if (localDistance > entry.containerRadius) {
            var localScale = entry.containerRadius / localDistance;
            position.x = parentPosition.x + localX * localScale;
            position.y = parentPosition.y + localY * localScale;
            position.z = parentPosition.z + localZ * localScale;
          }
        }
      });
    }

    if (planarRepulsion) {
      for (var crossingPass = 0; crossingPass < 48; crossingPass += 1) {
        var crossingAdjusted = false;
        for (var crossingFirstIndex = 0; crossingFirstIndex < links.length; crossingFirstIndex += 1) {
          for (var crossingSecondIndex = crossingFirstIndex + 1; crossingSecondIndex < links.length; crossingSecondIndex += 1) {
            var crossingFirst = links[crossingFirstIndex];
            var crossingSecond = links[crossingSecondIndex];
            var crossingGroup = linkForceGroup(crossingFirst);
            if (!crossingGroup || crossingGroup !== linkForceGroup(crossingSecond)) continue;
            if (!linksCross(crossingFirst, crossingSecond)) continue;
            var crossingVector = vectorBetween(crossingFirst.fromId, crossingFirst.toId).direction;
            var crossingNormal = { x: -crossingVector.y, y: crossingVector.x };
            var crossingSign = deterministicDirection(
              crossingFirst.fromId + ':' + crossingFirst.toId,
              crossingSecond.fromId + ':' + crossingSecond.toId
            ).x < 0 ? -1 : 1;
            var crossingStep = Math.max(0.08, edgeRepulsionStrength * 0.35);
            [crossingFirst.fromId, crossingFirst.toId].forEach(function (id) {
              if (byId.get(id).fixed) return;
              positions[id].x += crossingNormal.x * crossingStep * crossingSign;
              positions[id].y += crossingNormal.y * crossingStep * crossingSign;
            });
            [crossingSecond.fromId, crossingSecond.toId].forEach(function (id) {
              if (byId.get(id).fixed) return;
              positions[id].x -= crossingNormal.x * crossingStep * crossingSign;
              positions[id].y -= crossingNormal.y * crossingStep * crossingSign;
            });
            crossingAdjusted = true;
          }
        }
        if (!crossingAdjusted) break;
      }
      for (var separationPass = 0; separationPass < 48; separationPass += 1) {
        var adjusted = false;
        for (var firstIndex = 0; firstIndex < ids.length; firstIndex += 1) {
          for (var secondIndex = firstIndex + 1; secondIndex < ids.length; secondIndex += 1) {
            var firstId = ids[firstIndex];
            var secondId = ids[secondIndex];
            var firstEntry = byId.get(firstId);
            var secondEntry = byId.get(secondId);
            if (
              forceGroup(firstEntry) !== forceGroup(secondEntry)
              || firstEntry.parentId
              || secondEntry.parentId
            ) continue;
            var planarSeparation = repulsionVectorBetween(firstId, secondId);
            var requiredDistance = (firstEntry.radius + secondEntry.radius) * radiusScale + baseGap;
            var overlap = requiredDistance - planarSeparation.distance;
            if (overlap <= 0.004) continue;
            var movable = Number(!firstEntry.fixed) + Number(!secondEntry.fixed);
            if (!movable) continue;
            var correction = overlap / movable * 0.92;
            if (!firstEntry.fixed) {
              positions[firstId].x -= planarSeparation.direction.x * correction;
              positions[firstId].y -= planarSeparation.direction.y * correction;
            }
            if (!secondEntry.fixed) {
              positions[secondId].x += planarSeparation.direction.x * correction;
              positions[secondId].y += planarSeparation.direction.y * correction;
            }
            adjusted = true;
          }
        }
        ids.forEach(function (id) {
          var entry = byId.get(id);
          if (entry.parentId || entry.fixed) return;
          var position = positions[id];
          var fieldDistance = Math.hypot(position.x, position.y, position.z);
          if (fieldDistance <= maxFieldRadius) return;
          var fieldScale = maxFieldRadius / fieldDistance;
          position.x *= fieldScale;
          position.y *= fieldScale;
          position.z *= fieldScale;
        });
        if (!adjusted) break;
      }
    }

    return positions;
  }

  var api = Object.freeze({
    deriveCarrierMode: deriveCarrierMode,
    detailModeFor: detailModeFor,
    cycleNodeDetailMode: cycleNodeDetailMode,
    toggleNodeSurface: toggleNodeSurface,
    toggleFieldSurfaces: toggleFieldSurfaces,
    insertionVortexRadius: insertionVortexRadius,
    toggleFieldChildren: toggleFieldChildren,
    descendantPortalId: descendantPortalId,
    visiblePortalRelationship: visiblePortalRelationship,
    hydrateNodePath: hydrateNodePath,
    restoreRevealedNodes: restoreRevealedNodes,
    resetSnapshotNodeState: resetSnapshotNodeState,
    relationshipPairs: relationshipPairs,
    nodeLineage: nodeLineage,
    relaxRelationshipLayout: relaxRelationshipLayout
  });

  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SpatialVisualModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
