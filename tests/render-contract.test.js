const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'spatial-engine.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(__dirname, '..', 'spatial.css'), 'utf8');
const htmlSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function functionSource(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} exists`);

  const bodyStart = source.indexOf('{', start + marker.length);
  assert.notEqual(bodyStart, -1, `${name} has a body`);

  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  assert.fail(`${name} body is bounded`);
}

test('every carrier renders as a tunnel without an entity refraction route', () => {
  const carrier = functionSource('drawSphere');

  assert.match(carrier, /drawTunnelInterior\s*\(\s*screen\s*,\s*node/);
  assert.doesNotMatch(carrier, /drawEntityRefraction|carrierMode\s*===/);
  assert.doesNotMatch(source, /function\s+drawEntityRefraction\s*\(/);
});

test('cluster overview renders black void outside clipped domain tunnels', () => {
  const scene = functionSource('renderScene');
  const cluster = functionSource('drawClusterField');
  const tunnel = functionSource('drawClusterTunnelInterior');

  assert.match(scene, /if\s*\(state\.clusterFieldOpen\)\s*\{[\s\S]*drawClusterVoid\(\)/);
  assert.match(scene, /else\s*\{[\s\S]*drawStaticBackdrop\(\)/);
  const backdrop = functionSource('drawStaticBackdrop');
  assert.match(backdrop, /drawStars\(layerContext\)[\s\S]*drawDomainBackdrop\(layerContext\)/);
  assert.match(cluster, /drawClusterTunnelInterior\s*\(\s*cluster\s*,\s*screen\s*\)/);
  assert.match(tunnel, /context\.clip\s*\(\s*\)/);
  assert.match(tunnel, /context\.ellipse\s*\(/);
  assert.doesNotMatch(tunnel, /rgb\([^)]*\/\s*(?:[5-9]\d|100)%\)/);
});

test('S cluster shell border and interior use independent persistent controls', () => {
  const cluster = functionSource('drawClusterField');
  const tunnel = functionSource('drawClusterTunnelInterior');

  assert.match(tunnel, /cluster\.projectionMode\s*===\s*["']nested["']/);
  assert.match(tunnel, /nestedTunnelInteriorPercent\s*\/\s*100/);
  assert.match(cluster, /nestedTunnelPercent\s*\/\s*100/);
  assert.match(cluster, /nestedTunnelInteriorPercent\s*\/\s*100/);
  assert.match(cluster, /0\.58\s*\*\s*nestedTunnelStrength/);
  assert.match(cluster, /4\s*\*\s*nestedTunnelStrength/);
  assert.match(cluster, /drawClusterTunnelInterior\s*\(\s*cluster\s*,\s*screen\s*\)/);
});

test('connections come from relationshipPairs without a hard-coded root index chain', () => {
  const connections = functionSource('drawConnections');

  assert.match(
    connections,
    /visualModel\.relationshipPairs\s*\(\s*existingNodes\s*\(\s*state\.nodes\s*\)\s*\)/
  );
  assert.doesNotMatch(connections, /\brootPairs\b/);
});

test('real canvas consumes support bundles as branches, a common trunk, and ordered outputs', () => {
  assert.match(source, /visualModel\.supportBundles\s*\(\s*state\.supportClauses/);
  assert.match(source, /drawSupportBundle/);
  assert.match(source, /junctionRatio/);
  assert.match(source, /glyphs:\s*false/);
});

test('tunnel drawing is purely visual and does not reveal child topology', () => {
  const tunnel = functionSource('drawTunnelInterior');

  assert.doesNotMatch(tunnel, /prefetchChildDomain|drawMiniTopology/);
});

test('surface drawing exists without child or domain creation', () => {
  const surface = functionSource('drawSurfaceLayer');

  assert.doesNotMatch(
    surface,
    /createSatellites|prefetchChildDomain|createDomain|drawMiniTopology/
  );
});

test('surface drawing is gated by the independent surfaceVisible flag', () => {
  const carrier = functionSource('drawSphere');

  assert.match(
    carrier,
    /if\s*\(\s*node\.surfaceVisible\s*\)\s*\{[\s\S]*?drawSurfaceLayer\s*\(\s*screen\s*,\s*node\s*\)/
  );
});

test('floating detail mode renders focused node and group detail panels below their labels', () => {
  assert.match(source, /function drawFloatingDetail\(/);
  assert.match(source, /detailModeFor\(item\.node\)\s*===\s*["']floating["']/);
  assert.match(source, /detailModeFor\(cluster\.detailNode\)\s*===\s*["']floating["']/);
  assert.match(source, /clusterDetailText\(/);
  assert.match(source, /floatingClusterDetailCount/);
  assert.match(source, /measureText/);
  assert.match(source, /roundRect/);
  assert.match(source, /state\.clusterDetailCandidates\s*=\s*\[\]/);
  assert.match(source, /if\s*\(drawLabel\(item,\s*placement\)\s*&&\s*placement\s*&&\s*placement\.box\)/);
  assert.match(source, /if\s*\(clusterLabelAlpha\s*>\s*0\.001\)/);
  assert.match(source, /if\s*\(renderedLabelAlpha\s*<=\s*0\.001\)\s*return false/);
  assert.match(source, /节点与团已切换为悬浮详情/);
  assert.doesNotMatch(source, /节点与团已切换为镜面详情/);
});

test('mirror surface renders bounded node detail text when content exists', () => {
  const content = functionSource('drawSurfaceContent');
  const wrap = functionSource('wrapSurfaceText');

  assert.match(content, /node\.description/);
  assert.match(content, /wrapSurfaceText\s*\(/);
  assert.match(content, /spherePath\s*\(\s*screen\s*\)[\s\S]*context\.clip\s*\(\s*\)/);
  assert.match(content, /const\s+maxDescriptionLines\s*=\s*Math\.max\s*\(/);
  assert.match(content, /Math\.floor\s*\(\s*descriptionHeight\s*\/\s*lineHeight\s*\)/);
  assert.match(content, /wrapSurfaceText\s*\(\s*description\s*,\s*descriptionWidth\s*,\s*maxDescriptionLines\s*\)/);
  assert.doesNotMatch(content, /wrapSurfaceText\s*\(\s*description\s*,[\s\S]*?,\s*3\s*\)/);
  assert.match(wrap, /context\.measureText\s*\(/);
  assert.match(wrap, /maxLines/);
});

test('mirror surface renders image thumbnails and non-image attachment summaries', () => {
  const content = functionSource('drawSurfaceContent');
  const image = functionSource('surfaceImageFor');

  assert.match(content, /node\.attachment/);
  assert.match(content, /startsWith\s*\(\s*["']image\/["']\s*\)/);
  assert.match(content, /context\.drawImage\s*\(/);
  assert.match(content, /attachment\.name/);
  assert.match(content, /attachment\.size/);
  assert.match(image, /surfaceImageCache/);
  assert.match(image, /addEventListener\s*\(\s*["']load["']/);
});

test('content preview sits above the abstract mirror and below the structural boundary', () => {
  const carrier = functionSource('drawSphere');
  const surfaceIndex = carrier.indexOf('drawSurfaceLayer(screen, node)');
  const contentIndex = carrier.indexOf('drawSurfaceContent(screen, node)');
  const boundaryIndex = carrier.indexOf('drawStructuralBoundary(');

  assert.ok(surfaceIndex !== -1 && contentIndex > surfaceIndex);
  assert.ok(boundaryIndex > contentIndex);
});

test('mirror surface covers the interior while the structural boundary stays on top', () => {
  const carrier = functionSource('drawSphere');

  const tunnelIndex = carrier.indexOf('drawTunnelInterior(screen, node');
  const surfaceIndex = carrier.indexOf('drawSurfaceLayer(screen, node)');
  const boundaryIndex = carrier.indexOf('drawStructuralBoundary(');
  assert.notEqual(tunnelIndex, -1, 'tunnel interior is drawn');
  assert.notEqual(surfaceIndex, -1, 'mirror surface is drawn');
  assert.notEqual(boundaryIndex, -1, 'structural boundary is drawn');
  assert.ok(tunnelIndex < surfaceIndex, 'mirror surface covers the tunnel interior');
  assert.ok(surfaceIndex < boundaryIndex, 'structural boundary remains visible above the mirror');
});

test('structural boundary keeps the full tunnel contour system for every carrier', () => {
  const boundary = functionSource('drawStructuralBoundary');

  assert.doesNotMatch(boundary, /carrierMode/);
  assert.match(boundary, /TUNNEL_BOUNDARY_CONTOURS/);
  assert.match(boundary, /context\.ellipse\s*\(/);
  assert.match(boundary, /context\.setLineDash\s*\(/);
  assert.match(boundary, /spherePath\s*\(\s*screen\s*\)/);
  assert.match(boundary, /context\.globalCompositeOperation\s*=\s*["']lighter["']/);
  assert.match(boundary, /context\.shadowBlur/);
});

test('a mirrored tunnel keeps a dark moat and broken luminous perimeter', () => {
  const boundary = functionSource('drawStructuralBoundary');
  const carrier = functionSource('drawSphere');

  assert.match(boundary, /surfaceVisible/);
  assert.match(boundary, /if\s*\(\s*surfaceVisible\s*\)/);
  assert.doesNotMatch(boundary, /carrierMode/);
  assert.match(boundary, /theme\["space-0"\]/);
  assert.match(boundary, /context\.arc\s*\(/);
  assert.match(carrier, /drawStructuralBoundary\([\s\S]*node\.surfaceVisible/);
});

test('final confirmation count renders one to three delayed outward light rings', () => {
  const ripples = functionSource('drawConfirmationRipples');

  assert.match(ripples, /clamp\s*\(\s*ripple\.count\s*,\s*1\s*,\s*3\s*\)/);
  assert.match(ripples, /RIPPLE_LAYER_DELAY/);
  assert.match(ripples, /RIPPLE_LAYER_SPACING/);
  assert.match(ripples, /RIPPLE_COUNT_WIDTH_STEP/);
  assert.match(ripples, /RIPPLE_COUNT_ALPHA_STEP/);
  assert.match(ripples, /RIPPLE_COUNT_TRAVEL_STEP/);
  assert.match(ripples, /const\s+countStrength\s*=\s*count\s*-\s*1/);
  assert.match(ripples, /Math\.pow\s*\(\s*1\s*-\s*progress/);
  assert.match(ripples, /layer\s*\*\s*layerSpacing/);
  assert.match(ripples, /theme\.ink/);
});

test('detail lens magnifies the abstract surface without exposing child topology', () => {
  const lens = functionSource('drawLensInterior');

  assert.match(lens, /drawSurfaceLayer\s*\(\s*screen\s*,\s*node\s*\)/);
  assert.doesNotMatch(lens, /drawMiniTopology|satellites/);
});

test('association topology links are curved and use an arrowhead plus a distinct swallowtail, hierarchy links do not', () => {
  const link = functionSource('drawTopologyLink');

  assert.match(link, /(?:bezierCurveTo|quadraticCurveTo)\s*\(/);
  assert.match(link, /if\s*\(\s*!hierarchy\s*&&\s*!pending\s*\)/);
  assert.match(link, /const\s+tangentX\s*=\s*end\.x\s*-\s*controlTwo\.x/);
  assert.match(link, /const\s+originTangentX\s*=\s*controlOne\.x\s*-\s*start\.x/);
  assert.match(link, /const\s+tailDepth/);
  assert.match(link, /const\s+tailWidth/);
  assert.match(link, /context\.closePath\(\)/);
  assert.doesNotMatch(link, /fillText\(["'](?:起|终)["']/);
});

test('hierarchy links are dim dashed while peer links are bright solid and labelled', () => {
  const link = functionSource('drawTopologyLink');
  assert.match(link, /context\.setLineDash\s*\(\s*pending\s*\?\s*\[[^\]]+\]\s*:\s*hierarchy\s*\?\s*\[[^\]]+\]\s*:\s*\[\s*\]\s*\)/);
  assert.match(link, /const\s+visibilityFloor\s*=\s*hierarchy\s*\?\s*0\.12\s*:\s*0\.16/);
  assert.match(link, /relationshipVisualStyle\s*\(\s*state\.demo\.settings/);
  assert.match(link, /baseWidth:\s*hierarchy\s*\?\s*0\.9\s*:\s*1\.35/);
  assert.match(link, /context\.lineWidth\s*=\s*relationshipStyle\.lineWidth/);
  assert.match(link, /relationship\.label/);
  assert.match(link, /italic 500 11px/);
  assert.match(link, /context\.shadowColor\s*=\s*theme\["space-0"\]/);
  assert.match(link, /relationship\.showLabel\s*!==\s*false/);
  assert.match(link, /distance\s*>=\s*labelDistanceFloor/);
  assert.match(link, /Math\.max\s*\(\s*0\.5\s*,\s*contextWeight\s*\)/);
  assert.match(link, /Math\.max\s*\(\s*visibilityFloor\s*,/);
});

test('dense hierarchy labels are budgeted per parent and distant child labels stay silent', () => {
  const connections = functionSource('drawConnections');
  const label = functionSource('drawLabel');

  assert.match(connections, /labelledHierarchyParents\s*=\s*new Set\s*\(/);
  assert.match(connections, /labelledHierarchyParents\.has\s*\(\s*relationship\.fromId\s*\)/);
  assert.match(label, /item\.level\s*===\s*0[\s\S]*semanticIndex\s*>=\s*3/);
});

test('tunnel carrier restores a full deep radial well and complete nested contours', () => {
  const tunnel = functionSource('drawTunnelInterior');

  assert.match(tunnel, /createRadialGradient\s*\(/);
  assert.match(tunnel, /const\s+contourCount\s*=\s*6/);
  assert.match(tunnel, /context\.ellipse\s*\([\s\S]*?0\s*,\s*Math\.PI\s*\*\s*2/);
});

test('child domains render a low-contrast fragmented deep tunnel and entry label', () => {
  const backdrop = functionSource('drawDomainBackdrop');
  const staticBackdrop = functionSource('drawStaticBackdrop');
  const scene = functionSource('renderScene');

  assert.match(backdrop, /state\.depth\s*===\s*0/);
  assert.match(backdrop, /state\.domainStack\.at\s*\(\s*-1\s*\)/);
  assert.match(backdrop, /createRadialGradient\s*\(/);
  assert.match(backdrop, /entry\.nodeLabel/);
  assert.match(scene, /drawStaticBackdrop\s*\(\s*\)/);
  assert.match(staticBackdrop, /drawStars\(layerContext\)[\s\S]*drawDomainBackdrop\(layerContext\)/);
  assert.match(backdrop, /DOMAIN_TUNNEL_DEPTH_LAYERS/);
  assert.match(backdrop, /DOMAIN_TUNNEL_FRAGMENTS/);
  assert.match(backdrop, /context\.shadowBlur/);
  assert.match(backdrop, /context\.setLineDash\s*\(/);
  assert.match(backdrop, /context\.lineWidth\s*=\s*Math\.max\s*\(\s*2/);
  assert.match(backdrop, /fragmentStart/);
  assert.match(backdrop, /fragmentEnd/);
  assert.match(backdrop, /spiralProgress/);
  assert.match(backdrop, /context\.lineTo\s*\(/);
  assert.doesNotMatch(backdrop, /context\.setLineDash\s*\(\s*\[\s*Math\.max/);
  assert.doesNotMatch(backdrop, /0\s*,\s*Math\.PI\s*\*\s*2\s*\)\s*;\s*\n\s*context\.stroke\s*\(\s*\)/);
});

test('generated domains use a minimal connector and satellites form ordered local chains', () => {
  const domain = functionSource('createDomain');
  const satellites = functionSource('createSatellites');
  const connector = functionSource('connectVisualComponents');

  assert.match(domain, /connectVisualComponents\s*\(\s*nodes\s*\)/);
  assert.match(connector, /components/);
  assert.match(satellites, /index\s*<\s*parent\.satellites\.length\s*-\s*1/);
  assert.doesNotMatch(satellites, /index\s*\+=\s*2/);
  assert.match(satellites, /sharedOrbitSpeed/);
  assert.match(satellites, /index\s*\/\s*Math\.max\s*\(\s*1\s*,\s*count\s*\)/);
  assert.doesNotMatch(satellites, /parent\.radius\s*\*\s*\(\s*2\.2/);
});

test('the right-side tool is a recursive domain path map, not a world sphere or left anchors', () => {
  const tools = functionSource('addSpatialTools');
  const map = functionSource('drawDomainPathMap');

  assert.match(tools, /kind:\s*["']pathStep["']/);
  assert.match(tools, /label:\s*["']全域["']/);
  assert.match(tools, /state\.domainStack\.map\s*\(/);
  assert.doesNotMatch(tools, /kind:\s*["'](?:ancestor|worldLens)["']/);
  assert.match(map, /item\.kind\s*===\s*["']pathStep["']/);
  assert.match(map, /isCurrent/);
  assert.match(map, /createLinearGradient\s*\(/);
  assert.doesNotMatch(tools, /visiblePathEntries|slice\s*\(\s*-6\s*\)|length\s*<=\s*7/);
  assert.match(tools, /pathEntries\.forEach\s*\(/);
  assert.match(tools, /availablePathSpan\s*\/\s*\(\s*pathEntries\.length\s*-\s*1\s*\)/);
});

test('path map history steps return directly to their represented depth', () => {
  const pointer = functionSource('directPointerIntent');

  assert.match(pointer, /item\.kind\s*===\s*["']pathStep["']/);
  assert.match(pointer, /intent:\s*["']exitToDepth["']/);
  assert.match(pointer, /targetDepth:\s*item\.targetDepth/);
});

test('selection readout names seeded or empty tunnels and independent surface state', () => {
  const selection = functionSource('updateSelectionUI');

  assert.match(selection, /visualModel\.deriveCarrierMode\s*\(\s*state\.selected\s*\)/);
  assert.match(selection, /隧洞载体/);
  assert.match(selection, /空隧洞/);
  assert.doesNotMatch(selection, /末级实体/);
  assert.match(selection, /surfaceVisible/);
  assert.match(selection, /球面开启/);
  assert.match(selection, /球面静默/);
});

test('canvas labels keep a readable twelve-pixel minimum and adjustable ordinary alpha floor', () => {
  const label = functionSource('drawLabel');

  assert.match(label, /const\s+ordinaryLabelAlpha\s*=\s*state\.demo\.settings\.otherLabelBrightnessPercent\s*\/\s*100/);
  assert.match(label, /const\s+highlightedLabelAlpha\s*=\s*state\.demo\.settings\.highlightedLabelBrightnessPercent\s*\/\s*100/);
  assert.match(label, /const\s+labelAlphaFloor\s*=\s*hierarchyHighlighted[\s\S]*highlightedLabelAlpha[\s\S]*emphasizedLabel\s*\?\s*0\.94\s*:\s*ordinaryLabelAlpha/);
  assert.match(
    label,
    /context\.globalAlpha\s*=\s*Math\.max\s*\(\s*labelAlphaFloor\s*,\s*labelAlpha\s*\)/
  );
  assert.doesNotMatch(label, /\b(?:9|10)px\b/);
  assert.match(label, /\b12px\b/);
  assert.match(label, /context\.shadowColor\s*=\s*theme\["space-0"\]/);
});

test('far overview keeps every top-level node name independent of semantic radius', () => {
  const label = functionSource('drawLabel');

  assert.match(label, /const\s+persistentOverviewLabel\s*=\s*item\.kind\s*===\s*["']node["']\s*&&\s*item\.level\s*===\s*0/);
  assert.match(label, /persistentOverviewLabel\s*\|\|\s*selected\s*\|\|\s*hovered/);
});

test('far overview labels choose a readable screen position without hiding collisions', () => {
  const layout = functionSource('placeReadableLabels');

  assert.match(layout, /context\.measureText\s*\(/);
  assert.match(layout, /overlapArea\s*\(/);
  assert.match(layout, /candidates\.map\s*\(/);
  assert.match(layout, /Math\.min\s*\(/);
  assert.doesNotMatch(layout, /return\s+null/);
});

test('dense cluster titles and node labels use expanding collision-avoidance rings', () => {
  const clusterField = functionSource('drawClusterField');
  const nodeLabels = functionSource('placeReadableLabels');

  assert.match(clusterField, /clusterLabelBoxes/);
  assert.match(clusterField, /labelRingOffsets/);
  assert.match(clusterField, /overlapArea\s*\(/);
  assert.match(nodeLabels, /labelRingOffsets/);
  assert.match(nodeLabels, /flatMap/);
});

test('short codes use ink-2 at twelve pixels with the same alpha floor', () => {
  const label = functionSource('drawLabel');
  const shortCodeBranch = label.slice(label.indexOf('if (item.kind === "node"'));

  assert.match(shortCodeBranch, /theme\["ink-2"\]/);
  assert.match(shortCodeBranch, /Math\.max\s*\(\s*labelAlphaFloor\s*,/);
  assert.match(shortCodeBranch, /\b12px\b/);
  assert.doesNotMatch(shortCodeBranch, /theme\.muted|0\.54|\b9px\b/);
});

test('Hallmark stamp records the full slop sweep and canvas label contrast evidence', () => {
  const stamp = cssSource.slice(0, cssSource.indexOf('*/') + 2);

  assert.match(stamp, /slop:\s*pass\s*\([^)]*1–58[^)]*no cards[^)]*\)/);
  assert.match(stamp, /contrast:\s*pass\s*\([^)]*ink-2[^)]*alpha floor 0\.76[^)]*\)/);
  assert.match(stamp, /4\.80:1 on stacked blue field/);
});

test('H toggles a translucent non-modal help overlay grouped by current controls', () => {
  assert.match(source, /case ["']toggleHelp["']:[\s\S]{0,100}toggleHelpPanel\(\)/);
  assert.match(htmlSource, /id=["']helpPanel["'][^>]*class=["'][^"']*help-overlay/);
  for (const group of ['视角', '鼠标', '摄像机', '导航', '批量', '编辑']) {
    assert.match(htmlSource, new RegExp(`data-help-group=["']${group}["']`), group);
  }
  assert.match(cssSource, /#helpPanel\.help-overlay\s*\{/);
  assert.match(cssSource, /background:\s*rgb\([^;]+\/\s*(?:0\.[5-8]\d|[5-8]\d%)/);
  assert.doesNotMatch(cssSource, /#helpPanel\.help-overlay[\s\S]{0,900}backdrop-filter/);
});

test('visible help documents CapsLock details and middle-drag orbit without legacy Space camera', () => {
  assert.match(htmlSource, /CapsLock[\s\S]*名称[\s\S]*镜面[\s\S]*透明页/);
  assert.match(htmlSource, /按住中键[\s\S]*旋转/);
  assert.doesNotMatch(htmlSource, /Space\s*\+\s*(?:移动|左拖)/);
});

test('maximized mirror keeps a canvas text fallback while Markdown overlay synchronizes', () => {
  const content = functionSource('drawSurfaceContent');
  assert.doesNotMatch(content, /shouldRenderMarkdownSurface\(screen, node\)\s*\?\s*["']{2}/);
  assert.match(content, /toPlainText\(descriptionSource\)/);
});

test('triple CapsLock magnifier exposes a scrollable full Markdown reader', () => {
  assert.match(htmlSource, /id="detailMagnifier"/);
  assert.match(htmlSource, /id="detailMagnifierContent"/);
  assert.match(source, /registerCapsLock/);
  assert.match(source, /renderMarkdown\(detail\)/);
  assert.match(source, /updateDetailMagnifier\(state\.pointerPosition, state\.hovered\)/);
  assert.match(cssSource, /\.detail-magnifier[\s\S]*overflow:\s*auto/);
  assert.match(cssSource, /\.detail-magnifier-cursor/);
});

test('magnifier uses an unrestricted native cursor while panel work stays frame-coalesced', () => {
  assert.match(cssSource, /#spaceCanvas\[data-detail-magnifier=["']on["']\][\s\S]*cursor:\s*url\(/);
  assert.doesNotMatch(source, /detailMagnifierCursor\.style\.(?:left|top|transform)\s*=/);
  assert.match(source, /canvas\.dataset\.detailMagnifier/);
  const frame = functionSource('frame');
  assert.match(frame, /renderScene\(\);[\s\S]*updateDetailMagnifier\(state\.pointerPosition, state\.hovered\)/);
});

test('the large magnifier panel only lays out when its target or viewport changes', () => {
  assert.match(source, /state\.detailMagnifier\.layoutKey\s*!==\s*layoutKey/);
});

test('magnifier resolves only visible rendered targets and never leaks a hidden descendant carrier', () => {
  assert.match(source, /function currentMagnifierNode\(point\)/);
  assert.match(source, /!region\.item\.clusterShellProxy/);
  const update = functionSource('updateDetailMagnifier');
  assert.doesNotMatch(update, /regions:\s*state\.clusterHitRegions/);
  assert.match(source, /magnifierNode:/);
});

test('magnifier highlights its exact node or relation target and renders relation detail', () => {
  const update = functionSource('updateDetailMagnifier');
  const sphere = functionSource('drawSphere');
  const relation = functionSource('drawTopologyLink');

  assert.match(update, /currentMagnifierRelation\s*\(/);
  assert.match(update, /targetKind/);
  assert.match(update, /targetNodeKey/);
  assert.match(update, /targetEdgeId/);
  assert.match(sphere, /magnifierHighlighted/);
  assert.match(relation, /magnifierHighlighted/);
  assert.match(update, /nodeHit\.ownerPath/);
  assert.match(update, /normalizedDistance\s*<=\s*0\.72/);
  assert.match(sphere, /magnifierFocusActive/);
  assert.match(relation, /magnifierFocusActive/);
  assert.match(relation, /for \(const sample of \[0\.2, 0\.35, 0\.5, 0\.65, 0\.8\]\)/);
  assert.doesNotMatch(relation, /fillText\(["'](?:起|终)["']/);
  assert.match(update, /target\.kind\s*===\s*["']relationship["']/);
});

test('floating details search beyond the initial local offsets before hiding a valid detail', () => {
  assert.match(source, /for \(const offset of \[0, 18, 38, 68, 106, 152, 210, 280, 360\]\)/);
});

test('locked projected nodes carry a visible lock badge without rewriting their label', () => {
  const draw = functionSource('drawLabel');
  assert.match(draw, /node\.lockState/);
  assert.match(draw, /🔒/u);
});
