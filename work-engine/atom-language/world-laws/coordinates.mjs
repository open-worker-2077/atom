function childrenOf(anchor, matches) {
  return matches.filter((candidate) => candidate.parent === anchor);
}

function siblingsOf(anchor, matches) {
  return matches.filter((candidate) => candidate.parent === anchor.parent);
}

function addLatitude(selected, anchor, matches, parameter) {
  if (parameter > 0) {
    let current = anchor;
    for (let step = 0; step < parameter && current.parent; step += 1) {
      current = current.parent;
      selected.add(current);
    }
    return;
  }
  let frontier = [anchor];
  for (let step = 0; step < Math.abs(parameter); step += 1) {
    frontier = frontier.flatMap((candidate) => childrenOf(candidate, matches));
    for (const candidate of frontier) selected.add(candidate);
  }
}

function addLongitude(selected, anchor, matches, parameter) {
  const siblings = siblingsOf(anchor, matches);
  const index = siblings.indexOf(anchor);
  if (index < 0 || parameter === 0) return;
  const direction = Math.sign(parameter);
  for (let distance = 1; distance <= Math.abs(parameter); distance += 1) {
    const candidate = siblings[index + distance * direction];
    if (candidate) selected.add(candidate);
  }
}

export function selectCoordinateScope(anchor, matches, routes = []) {
  const selected = new Set([anchor]);
  for (const route of routes) {
    if (route.axis === 'latitude') {
      addLatitude(selected, anchor, matches, route.parameter);
    }
    if (route.axis === 'longitude') {
      addLongitude(selected, anchor, matches, route.parameter);
    }
  }
  return selected;
}
