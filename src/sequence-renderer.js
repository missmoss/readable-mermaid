import puppeteer from "puppeteer-core";
import {
  buildChromeLaunchArgs,
  createTemporaryBrowserProfile,
  isLocalBrowserRequest,
  removeTemporaryBrowserProfile
} from "./browser.js";
import { EXIT_CODES, ReadableMermaidError } from "./errors.js";

const ARROW_MARKER_ID = "sequence-arrow";
const SEQUENCE_FONT_STACK =
  "'SF Pro Text', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
const SEQUENCE_THEME = {
  participantFill: "#eef2f7",
  participantStroke: "none",
  participantText: "#0f172a",
  lifelineStroke: "#cbd5e1",
  arrowStroke: "#475569",
  messageText: "#111827",
  noteFill: "#fbfcfe",
  noteStroke: "#cbd5e1",
  noteText: "#334155",
  blockFill: "none",
  blockStroke: "#d3dce8",
  blockLabelFill: "#edf2f7",
  branchLabelFill: "#fdfefe",
  branchLabelStroke: "#d6dee8",
  blockText: "#475569",
  badgeFill: "#334155"
};

export function renderSequenceSvgDocument(source, profile) {
  const diagram = parseSequenceDiagram(source);
  const candidate = buildSequenceCandidate(profile);
  const layout = layoutSequenceDiagram(diagram, candidate, profile);
  const svg = renderSequenceSvg(layout, candidate, profile);

  return {
    svg,
    layout,
    candidate
  };
}

export async function renderSequenceDocInlineDiagram(source, profile) {
  const { svg } = renderSequenceSvgDocument(source, profile);

  const { browser, cleanup } = await launchBrowser(profile);
  let png;

  try {
    const page = await browser.newPage();
    await lockDownPage(page, profile);
    png = await renderPng(page, svg, profile);
  } finally {
    await browser.close().catch(() => {});
    await cleanup();
  }

  return {
    svg,
    png
  };
}

function unsupportedSequenceSyntax(lineNumber, line) {
  throw new ReadableMermaidError(
    `Unsupported Mermaid sequence syntax at line ${lineNumber}: ${line}`,
    {
      code: "UNSUPPORTED_SYNTAX",
      exitCode: EXIT_CODES.UNSUPPORTED_SYNTAX
    }
  );
}

function buildSequenceCandidate(profile) {
  const isScreenProfile = profile.pageWidthPx > 800;

  return {
    headerFontSize: isScreenProfile ? 16 : 13,
    messageFontSize: isScreenProfile ? 14 : 11,
    noteFontSize: isScreenProfile ? 12 : 10,
    blockFontSize: 9,
    outerPaddingX: 12,
    outerPaddingY: 12,
    participantPadX: 14,
    participantPadY: 11,
    participantMinWidth: isScreenProfile ? 128 : 104,
    participantMaxWidth: isScreenProfile ? 220 : 172,
    headerRowGap: 12,
    participantTopGap: 8,
    headerToBodyGap: 12,
    bodyToFooterGap: 14,
    footerBottomGap: 8,
    notePadX: 12,
    notePadY: 8,
    noteGap: 8,
    messageLineHeight: 15,
    labelToArrowGap: 4,
    arrowToNextGap: 10,
    messagePadX: 4,
    badgeRadius: 9,
    messageMinAutoSpan: isScreenProfile ? 2 : 4,
    messageMaxAutoSpan: isScreenProfile ? 3 : 5,
    branchGap: 6,
    branchDividerGap: 10,
    blockPadX: 10,
    blockPadY: 8,
    blockIndent: 6
  };
}

export function parseSequenceDiagram(source) {
  const participants = [];
  const participantMap = new Map();
  const rootItems = [];
  const stack = [];
  let messageNumber = 0;

  function currentItems() {
    if (stack.length === 0) {
      return rootItems;
    }

    return stack.at(-1).branches.at(-1).items;
  }

  function ensureParticipant(alias, label = alias) {
    if (!participantMap.has(alias)) {
      const participant = { alias, label };
      participants.push(participant);
      participantMap.set(alias, participant);
      return participant;
    }

    const participant = participantMap.get(alias);
    if (label && participant.label === participant.alias) {
      participant.label = label;
    }
    return participant;
  }

  const lines = source.split("\n");

  for (const [index, rawLine] of lines.entries()) {
    const lineNumber = index + 1;
    const line = rawLine.trim();

    if (!line || line.startsWith("%%") || /^sequenceDiagram\b/i.test(line)) {
      continue;
    }

    if (/^autonumber\b/i.test(line)) {
      continue;
    }

    const participantDefinition = parseParticipantDefinition(line);
    if (participantDefinition) {
      ensureParticipant(participantDefinition.alias, participantDefinition.label);
      continue;
    }

    const note = parseNote(line);
    if (note) {
      note.participants.forEach((alias) => ensureParticipant(alias));
      currentItems().push(note);
      continue;
    }

    const activationDirective = parseActivationDirective(line);
    if (activationDirective) {
      ensureParticipant(activationDirective.participant);
      currentItems().push(activationDirective);
      continue;
    }

    const blockStart = parseBlockStart(line);
    if (blockStart) {
      const block = {
        type: "block",
        kind: blockStart.kind,
        label: blockStart.label,
        branches: [{ label: blockStart.label, items: [] }]
      };
      currentItems().push(block);
      stack.push(block);
      continue;
    }

    const branchStart = parseBranchStart(line);
    if (branchStart) {
      const activeBlock = stack.at(-1);
      if (!activeBlock || activeBlock.kind !== branchStart.kind) {
        unsupportedSequenceSyntax(lineNumber, line);
      }
      activeBlock.branches.push({ label: branchStart.label, items: [] });
      continue;
    }

    if (/^end\b/i.test(line)) {
      if (stack.length === 0) {
        unsupportedSequenceSyntax(lineNumber, line);
      }
      stack.pop();
      continue;
    }

    const message = parseMessage(line);
    if (message) {
      ensureParticipant(message.from);
      ensureParticipant(message.to);
      messageNumber += 1;
      currentItems().push({
        ...message,
        type: "message",
        number: messageNumber
      });
      continue;
    }

    unsupportedSequenceSyntax(lineNumber, line);
  }

  if (stack.length > 0) {
    const unfinishedBlock = stack.at(-1);
    throw new ReadableMermaidError(
      `Unclosed Mermaid sequence block: ${unfinishedBlock.kind}${unfinishedBlock.label ? ` ${unfinishedBlock.label}` : ""}`,
      {
        code: "UNSUPPORTED_SYNTAX",
        exitCode: EXIT_CODES.UNSUPPORTED_SYNTAX
      }
    );
  }

  return {
    participants,
    items: rootItems,
    messageCount: messageNumber
  };
}

function parseParticipantDefinition(line) {
  const quotedAsMatch = line.match(/^(participant|actor)\s+"([^"]+)"\s+as\s+([A-Za-z0-9_]+)$/i);
  if (quotedAsMatch) {
    return { alias: quotedAsMatch[3], label: quotedAsMatch[2] };
  }

  const asMatch = line.match(/^(participant|actor)\s+([A-Za-z0-9_]+)\s+as\s+(.+)$/i);
  if (asMatch) {
    return { alias: asMatch[2], label: asMatch[3].trim() };
  }

  const quotedMatch = line.match(/^(participant|actor)\s+"([^"]+)"$/i);
  if (quotedMatch) {
    return { alias: quotedMatch[2], label: quotedMatch[2] };
  }

  const simpleMatch = line.match(/^(participant|actor)\s+([A-Za-z0-9_]+)$/i);
  if (simpleMatch) {
    return { alias: simpleMatch[2], label: simpleMatch[2] };
  }

  return null;
}

function parseNote(line) {
  const match = line.match(/^Note\s+over\s+([A-Za-z0-9_]+)(?:\s*,\s*([A-Za-z0-9_]+))?\s*:\s*(.+)$/i);
  if (!match) {
    return null;
  }

  return {
    type: "note",
    participants: [match[1], match[2]].filter(Boolean),
    text: match[3].trim()
  };
}

function parseBlockStart(line) {
  const match = line.match(/^(alt|par|opt|loop)\b(?:\s+(.+))?$/i);
  if (!match) {
    return null;
  }

  return {
    kind: match[1].toLowerCase(),
    label: (match[2] ?? "").trim()
  };
}

function parseActivationDirective(line) {
  const match = line.match(/^(activate|deactivate)\s+([A-Za-z0-9_]+)$/i);
  if (!match) {
    return null;
  }

  return {
    type: match[1].toLowerCase(),
    participant: match[2]
  };
}

function parseBranchStart(line) {
  const match = line.match(/^(else|and)\b(?:\s+(.+))?$/i);
  if (!match) {
    return null;
  }

  return {
    kind: match[1].toLowerCase() === "else" ? "alt" : "par",
    label: (match[2] ?? "").trim()
  };
}

function parseMessage(line) {
  const separatorIndex = line.indexOf(":");
  if (separatorIndex < 0) {
    return null;
  }

  const relation = line.slice(0, separatorIndex).trim();
  const text = line.slice(separatorIndex + 1).trim();
  const arrowTokens = ["-->>", "->>", "-->", "->", "--)", "-)"];
  const arrow = arrowTokens.find((token) => relation.includes(token));

  if (!arrow) {
    return null;
  }

  const [rawSource, rawTarget] = relation.split(arrow);
  const from = rawSource.trim().replace(/[+-]+$/g, "");
  const to = rawTarget.trim().replace(/^[+-]+/g, "").replace(/[+-]+$/g, "");

  if (!from || !to) {
    return null;
  }

  return {
    from,
    to,
    text,
    dashed: arrow.startsWith("--"),
    async: arrow.includes(")"),
    self: from === to
  };
}

function layoutSequenceDiagram(diagram, candidate, profile) {
  const participantCount = Math.max(diagram.participants.length, 1);
  const usableWidth = profile.pageWidthPx - candidate.outerPaddingX * 2;
  const laneWidth = usableWidth / participantCount;
  const lanes = diagram.participants.map((participant, index) => {
    const left = candidate.outerPaddingX + laneWidth * index;
    const right = left + laneWidth;
    const center = left + laneWidth / 2;
    return {
      ...participant,
      index,
      left,
      right,
      center
    };
  });
  const laneByAlias = new Map(lanes.map((lane) => [lane.alias, lane]));
  const labelBoxes = new Map(
    lanes.map((lane) => [
      lane.alias,
      fitParticipantLabel(lane.label, laneWidth, candidate)
    ])
  );
  const headerRows = packParticipantBoxes(lanes, labelBoxes, candidate.participantTopGap, candidate.headerRowGap);
  const headerBottom = headerRows.maxBottom;
  const contentLeft = candidate.outerPaddingX;
  const contentRight = profile.pageWidthPx - candidate.outerPaddingX;
  const bodyTop = headerBottom + candidate.headerToBodyGap;
  const layers = {
    lifelines: [],
    activationBars: [],
    blockBackgrounds: [],
    blockForegrounds: [],
    notes: [],
    arrows: [],
    badges: [],
    texts: [],
    boxes: []
  };

  for (const lane of lanes) {
    const placement = headerRows.placements.get(lane.alias);
    lane.headerBox = placement;
    layers.boxes.push(drawParticipantBox(placement, labelBoxes.get(lane.alias).lines, candidate));
  }

  const state = {
    candidate,
    lanes,
    laneByAlias,
    contentLeft,
    contentRight,
    layers,
    activationState: new Map(lanes.map((lane) => [lane.alias, []])),
    lastArrowY: null
  };
  const bodyBottom = layoutItems(diagram.items, state, bodyTop, 0);
  const footerTop = bodyBottom + candidate.bodyToFooterGap;
  closeOpenActivationBars(state, footerTop - 2);
  const footerRows = packParticipantBoxes(
    lanes,
    labelBoxes,
    footerTop,
    candidate.headerRowGap,
    headerRows.rowIndexes
  );

  for (const lane of lanes) {
    const footerPlacement = footerRows.placements.get(lane.alias);
    lane.footerBox = footerPlacement;
    layers.lifelines.push(
      svgLine(lane.center, lane.headerBox.y + lane.headerBox.height, lane.center, footerPlacement.y, {
        stroke: SEQUENCE_THEME.lifelineStroke,
        strokeWidth: 1.2,
        strokeOpacity: 1
      })
    );
    layers.boxes.push(drawParticipantBox(footerPlacement, labelBoxes.get(lane.alias).lines, candidate));
  }

  const intrinsicHeight = footerRows.maxBottom + candidate.footerBottomGap;
  const outputHeight = Math.ceil(profile.pageWidthPx * (intrinsicHeight / profile.pageWidthPx));

  return {
    candidate,
    lanes,
    layers,
    intrinsicWidth: profile.pageWidthPx,
    intrinsicHeight,
    outputHeight
  };
}

function fitParticipantLabel(label, laneWidth, candidate) {
  const targetWidth = clamp(laneWidth * 1.55, candidate.participantMinWidth, candidate.participantMaxWidth);
  const textWidth = Math.max(52, targetWidth - candidate.participantPadX * 2);
  const lines = wrapText(label, textWidth, candidate.headerFontSize, 3);
  const measuredWidth = Math.max(...lines.map((line) => measureTextWidth(line, candidate.headerFontSize)), 0);
  const boxWidth = clamp(
    Math.ceil(measuredWidth + candidate.participantPadX * 2),
    candidate.participantMinWidth,
    candidate.participantMaxWidth
  );
  const lineHeight = candidate.headerFontSize + 5;
  const boxHeight = Math.ceil(lines.length * lineHeight + candidate.participantPadY * 2);
  return {
    lines,
    boxWidth,
    boxHeight,
    lineHeight
  };
}

function packParticipantBoxes(lanes, boxSpecs, baseY, rowGap, preferredRowIndexes = null) {
  const rows = [];
  const placements = new Map();
  const minLeftBound = lanes[0]?.left ?? 0;
  const maxRightBound = lanes.at(-1)?.right ?? minLeftBound;

  function canPlace(row, left, right) {
    return row.items.every((item) => right + 10 <= item.left || left >= item.right + 10);
  }

  function ensureRow(index) {
    while (rows.length <= index) {
      rows.push({ items: [], height: 0 });
    }
  }

  for (const lane of lanes) {
    const spec = boxSpecs.get(lane.alias);
    const unclampedLeft = lane.center - spec.boxWidth / 2;
    const left = Math.round(clamp(unclampedLeft, minLeftBound, maxRightBound - spec.boxWidth));
    const right = left + spec.boxWidth;
    let rowIndex = null;
    const preferredIndex = preferredRowIndexes?.get(lane.alias);

    if (Number.isInteger(preferredIndex)) {
      ensureRow(preferredIndex);
      if (canPlace(rows[preferredIndex], left, right)) {
        rowIndex = preferredIndex;
      }
    }

    if (rowIndex === null) {
      for (let index = 0; index < rows.length; index += 1) {
        if (canPlace(rows[index], left, right)) {
          rowIndex = index;
          break;
        }
      }
    }

    if (rowIndex === null) {
      rowIndex = rows.length;
      ensureRow(rowIndex);
    }

    rows[rowIndex].items.push({ alias: lane.alias, left, right, spec });
    rows[rowIndex].height = Math.max(rows[rowIndex].height, spec.boxHeight);
    placements.set(lane.alias, {
      x: left,
      y: baseY,
      width: spec.boxWidth,
      height: spec.boxHeight,
      rowIndex
    });
  }

  let y = baseY;
  for (const row of rows) {
    row.top = y;
    row.bottom = y + row.height;
    for (const item of row.items) {
      const placement = placements.get(item.alias);
      placement.y = y + Math.round((row.height - placement.height) / 2);
    }
    y = row.bottom + rowGap;
  }

  return {
    placements,
    rowIndexes: new Map([...placements.entries()].map(([alias, placement]) => [alias, placement.rowIndex])),
    maxBottom: rows.length === 0 ? baseY : rows.at(-1).bottom,
    rowCount: rows.length
  };
}

function layoutItems(items, state, startY, depth) {
  let cursorY = startY;

  for (const item of items) {
    if (item.type === "note") {
      cursorY = layoutNote(item, state, cursorY);
      continue;
    }

    if (item.type === "message") {
      cursorY = layoutMessage(item, state, cursorY);
      continue;
    }

    if (item.type === "activate" || item.type === "deactivate") {
      cursorY = layoutActivationDirective(item, state, cursorY);
      continue;
    }

    if (item.type === "block") {
      cursorY = layoutBlock(item, state, cursorY, depth);
    }
  }

  return cursorY;
}

function layoutActivationDirective(item, state, currentY) {
  const lane = state.laneByAlias.get(item.participant);
  if (!lane) {
    return currentY;
  }

  const stack = state.activationState.get(item.participant) ?? [];
  const anchorY = state.lastArrowY ?? currentY;

  if (item.type === "activate") {
    stack.push({ startY: anchorY, level: stack.length });
    state.activationState.set(item.participant, stack);
    return currentY;
  }

  const activeBar = stack.pop();
  if (activeBar) {
    state.layers.activationBars.push(drawActivationBar(lane, activeBar.startY, anchorY, activeBar.level));
  }
  state.activationState.set(item.participant, stack);
  return currentY;
}

function layoutNote(note, state, currentY) {
  const firstLane = state.laneByAlias.get(note.participants[0]);
  const lastLane = state.laneByAlias.get(note.participants.at(-1));
  const left = Math.max(state.contentLeft, (firstLane ?? state.lanes[0]).left + 10);
  const right = Math.min(state.contentRight, (lastLane ?? state.lanes.at(-1)).right - 10);
  const width = Math.max(180, right - left);
  const lines = wrapText(note.text, width - state.candidate.notePadX * 2, state.candidate.noteFontSize, 4);
  const lineHeight = state.candidate.noteFontSize + 5;
  const textHeight = lines.length * lineHeight;
  const height = Math.ceil(textHeight + state.candidate.notePadY * 2);
  const textTop = currentY + (height - textHeight) / 2 + 1;
  state.layers.notes.push(
    svgRect(left, currentY, width, height, {
      rx: 10,
      ry: 10,
      fill: SEQUENCE_THEME.noteFill,
      fillOpacity: 1,
      stroke: SEQUENCE_THEME.noteStroke,
      strokeWidth: 0.9,
      strokeOpacity: 0.85
    })
  );
  state.layers.texts.push(
    svgMultilineText(lines, left + state.candidate.notePadX, textTop, {
      fontSize: state.candidate.noteFontSize,
      lineHeight,
      fill: SEQUENCE_THEME.noteText
    })
  );
  return currentY + height + state.candidate.noteGap;
}

function layoutMessage(message, state, currentY) {
  const fromLane = state.laneByAlias.get(message.from);
  const toLane = state.laneByAlias.get(message.to);
  const direction = message.self ? "self" : toLane.index >= fromLane.index ? "right" : "left";
  const span = Math.abs(toLane.index - fromLane.index) + 1;
  const laneWidth = state.lanes[0] ? state.lanes[0].right - state.lanes[0].left : state.contentRight - state.contentLeft;
  const useDenseLaneLayout = state.lanes.length >= 9 || laneWidth < 120;
  const autoSpanBase =
    span >= 4
      ? Math.min(state.lanes.length, span + 1)
      : Math.min(
          state.candidate.messageMaxAutoSpan,
          Math.max(state.candidate.messageMinAutoSpan ?? 2, span + 1)
        );
  const autoSpan = useDenseLaneLayout
    ? Math.min(
        state.lanes.length,
        Math.max(Math.min(state.candidate.messageMaxAutoSpan + 2, 6), autoSpanBase + 2)
      )
    : autoSpanBase;
  const badgeRadius = state.candidate.badgeRadius;
  let corridorLeft;
  let corridorRight;
  let anchor = "start";

  function expandLaneWindow(leftIndex, rightIndex, targetSpan) {
    const corridorSpan = rightIndex - leftIndex + 1;
    const extraSpan = Math.max(0, targetSpan - corridorSpan);
    let expandedLeft = leftIndex;
    let expandedRight = rightIndex;
    const leftBorrow = Math.min(leftIndex, Math.ceil(extraSpan / 2));
    const rightBorrow = Math.min(state.lanes.length - 1 - rightIndex, Math.floor(extraSpan / 2));

    expandedLeft -= leftBorrow;
    expandedRight += rightBorrow;

    const remainingExtra = extraSpan - leftBorrow - rightBorrow;
    if (remainingExtra > 0) {
      if (expandedLeft === 0) {
        expandedRight = Math.min(state.lanes.length - 1, expandedRight + remainingExtra);
      } else if (expandedRight === state.lanes.length - 1) {
        expandedLeft = Math.max(0, expandedLeft - remainingExtra);
      } else {
        expandedLeft = Math.max(0, expandedLeft - Math.ceil(remainingExtra / 2));
        expandedRight = Math.min(state.lanes.length - 1, expandedRight + Math.floor(remainingExtra / 2));
      }
    }

    return {
      leftIndex: expandedLeft,
      rightIndex: expandedRight
    };
  }

  if (direction === "right" || direction === "left") {
    const corridorLeftIndex = Math.min(fromLane.index, toLane.index);
    const corridorRightIndex = Math.max(fromLane.index, toLane.index);
    const { leftIndex: textLeftIndex, rightIndex: textRightIndex } = expandLaneWindow(
      corridorLeftIndex,
      corridorRightIndex,
      autoSpan
    );
    corridorLeft = state.lanes[textLeftIndex].left + 10;
    corridorRight = state.lanes[textRightIndex].right - 10;
    anchor = direction === "left" ? "end" : "start";
  } else {
    const selfTargetSpan = Math.max(autoSpan, useDenseLaneLayout ? 4 : 3);
    if (fromLane.index >= state.lanes.length - 2) {
      const { leftIndex, rightIndex } = expandLaneWindow(
        Math.max(0, fromLane.index - 1),
        fromLane.index,
        selfTargetSpan
      );
      corridorLeft = state.lanes[leftIndex].left + 10;
      corridorRight = state.lanes[rightIndex].right - 10;
      anchor = "end";
    } else {
      const { leftIndex, rightIndex } = expandLaneWindow(
        fromLane.index,
        Math.min(state.lanes.length - 1, fromLane.index + 1),
        selfTargetSpan
      );
      corridorLeft = useDenseLaneLayout
        ? state.lanes[leftIndex].left + 10
        : Math.max(state.lanes[leftIndex].left + 10, fromLane.center + badgeRadius + 10);
      corridorRight = state.lanes[rightIndex].right - 10;
      anchor = "start";
    }
  }

  corridorLeft = Math.max(corridorLeft, state.contentLeft + 6);
  corridorRight = Math.min(corridorRight, state.contentRight - 6);

  if (corridorRight - corridorLeft < (useDenseLaneLayout ? 140 : 90)) {
    const expandBy = useDenseLaneLayout ? 56 : 30;
    corridorLeft = Math.max(state.contentLeft + 6, corridorLeft - expandBy);
    corridorRight = Math.min(state.contentRight - 6, corridorRight + expandBy);
  }

  const textWidth = Math.max(96, corridorRight - corridorLeft);
  const lines = wrapText(message.text, textWidth - state.candidate.messagePadX * 2, state.candidate.messageFontSize, 6);
  const maxLineWidth = Math.max(...lines.map((line) => measureTextWidth(line, state.candidate.messageFontSize)), 0);
  const safeLineWidth = maxLineWidth + 10;

  function computeTextBounds(anchorMode, anchorX) {
    if (anchorMode === "middle") {
      return {
        left: anchorX - safeLineWidth / 2,
        right: anchorX + safeLineWidth / 2
      };
    }

    if (anchorMode === "end") {
      return {
        left: anchorX - safeLineWidth,
        right: anchorX
      };
    }

    return {
      left: anchorX,
      right: anchorX + safeLineWidth
    };
  }

  const textInsetLeft = state.contentLeft + 12;
  const textInsetRight = state.contentRight - 12;
  corridorLeft = Math.max(corridorLeft, textInsetLeft);
  corridorRight = Math.min(corridorRight, textInsetRight);

  const halfWidth = safeLineWidth / 2;
  const isRightEdgeSelfLoop = message.self && fromLane.index >= state.lanes.length - 2;
  const preferredCenter = isRightEdgeSelfLoop
    ? corridorRight - halfWidth
    : message.self
      ? fromLane.center
      : (fromLane.center + toLane.center) / 2;
  const textBoxCenter = clamp(preferredCenter, corridorLeft + halfWidth, corridorRight - halfWidth);
  const textBoxLeft = Math.max(corridorLeft, textBoxCenter - halfWidth);
  const textBoxRight = Math.min(corridorRight, textBoxCenter + halfWidth);
  const textX = anchor === "end" ? textBoxRight : anchor === "middle" ? textBoxCenter : textBoxLeft;

  const textBounds = computeTextBounds(anchor, textX);
  const textHeight = lines.length * state.candidate.messageLineHeight;
  const textTop = currentY;
  const badgeSafePadding = badgeRadius + 8;
  const badgeLeft = fromLane.center - badgeSafePadding;
  const badgeRight = fromLane.center + badgeSafePadding;
  const overlapsBadgeHorizontally = textBounds.left < badgeRight && textBounds.right > badgeLeft;
  const badgeVerticalClearance = overlapsBadgeHorizontally ? Math.ceil(badgeRadius * 0.8) : 0;
  const arrowY = textTop + textHeight + state.candidate.labelToArrowGap + badgeVerticalClearance;
  state.lastArrowY = arrowY;

  state.layers.texts.push(
    svgMultilineText(lines, textX, textTop, {
      fontSize: state.candidate.messageFontSize,
      lineHeight: state.candidate.messageLineHeight,
      fill: SEQUENCE_THEME.messageText,
      anchor
    })
  );

  if (message.self) {
    const loopWidth = Math.min(74, state.contentRight - fromLane.center - 12);
    const loopDepth = 24;
    const loopPath = [
      `M ${fromLane.center} ${arrowY}`,
      `H ${fromLane.center + loopWidth}`,
      `V ${arrowY + loopDepth}`,
      `H ${fromLane.center}`
    ].join(" ");
    state.layers.arrows.push(
      svgPath(loopPath, {
        stroke: SEQUENCE_THEME.arrowStroke,
        strokeWidth: 1.2,
        strokeOpacity: 1,
        fill: "none",
        dashed: message.dashed,
        markerEnd: `url(#${ARROW_MARKER_ID})`
      })
    );
  } else {
    state.layers.arrows.push(
      svgLine(fromLane.center, arrowY, toLane.center, arrowY, {
        stroke: SEQUENCE_THEME.arrowStroke,
        strokeWidth: 1.2,
        strokeOpacity: 1,
        dashed: message.dashed,
        markerEnd: `url(#${ARROW_MARKER_ID})`
      })
    );
  }

  state.layers.badges.push(
    svgCircle(fromLane.center, arrowY, badgeRadius, {
      fill: SEQUENCE_THEME.badgeFill,
      fillOpacity: 1,
      stroke: "none"
    })
  );
  state.layers.texts.push(
    svgText(String(message.number), fromLane.center, arrowY, {
      fontSize: Math.max(state.candidate.messageFontSize - 2, 10),
      fill: "#ffffff",
      anchor: "middle",
      weight: 700,
      baseline: "middle"
    })
  );

  const textBottom = textTop + textHeight;
  const arrowBottom = message.self ? arrowY + 24 : arrowY + badgeRadius;
  const messageBoxBottom = Math.max(textBottom, arrowBottom) + state.candidate.arrowToNextGap;
  const dynamicMessageBoxBottom =
    messageBoxBottom + Math.max(0, lines.length - 1) * Math.ceil(state.candidate.messageLineHeight * 0.22);

  return dynamicMessageBoxBottom;
}

function layoutBlock(block, state, currentY, depth) {
  const left = state.contentLeft + state.candidate.blockIndent * depth + 6;
  const right = state.contentRight - state.candidate.blockIndent * depth - 6;
  const label = [block.kind.toUpperCase(), block.label].filter(Boolean).join(" ");
  const labelLines = wrapText(label, 220, state.candidate.blockFontSize, 2);
  const labelHeight = labelLines.length * (state.candidate.blockFontSize + 4) + 10;
  const labelWidth = Math.max(
    84,
    ...labelLines.map((line) => measureTextWidth(line, state.candidate.blockFontSize) + 20)
  );
  const top = currentY;
  let cursorY = top + labelHeight + state.candidate.branchGap;
  const dividers = [];

  block.branches.forEach((branch, branchIndex) => {
    if (branchIndex > 0) {
      dividers.push(cursorY - Math.round(state.candidate.branchDividerGap / 2));
    }

    if (branch.label) {
      const branchLines = wrapText(branch.label, 180, state.candidate.blockFontSize, 2);
      const branchHeight = branchLines.length * (state.candidate.blockFontSize + 4) + 10;
      const branchWidth = Math.max(
        72,
        ...branchLines.map((line) => measureTextWidth(line, state.candidate.blockFontSize) + 18)
      );
      state.layers.blockForegrounds.push(
        svgRect(left + 12, cursorY, branchWidth, branchHeight, {
          rx: 8,
          ry: 8,
          fill: SEQUENCE_THEME.branchLabelFill,
          fillOpacity: 1,
          stroke: SEQUENCE_THEME.branchLabelStroke,
          strokeWidth: 0.9,
          strokeOpacity: 0.95
        })
      );
      state.layers.texts.push(
        svgMultilineText(branchLines, left + 21, cursorY + 6, {
          fontSize: state.candidate.blockFontSize,
          lineHeight: state.candidate.blockFontSize + 4,
          fill: SEQUENCE_THEME.blockText,
          weight: 500,
          letterSpacing: 0.1
        })
      );
      cursorY += branchHeight + 8;
    }

    cursorY = layoutItems(branch.items, state, cursorY, depth + 1) + state.candidate.branchGap;
  });

  const bottom = cursorY + state.candidate.blockPadY;
  state.layers.blockBackgrounds.push(
    svgRect(left, top, right - left, bottom - top, {
      rx: 10,
      ry: 10,
      fill: SEQUENCE_THEME.blockFill,
      fillOpacity: 1,
      stroke: SEQUENCE_THEME.blockStroke,
      strokeWidth: 1,
      strokeOpacity: 0.95
    })
  );
  state.layers.blockForegrounds.push(
    svgRect(left + 12, top + 8, labelWidth, labelHeight, {
      rx: 8,
      ry: 8,
      fill: SEQUENCE_THEME.blockLabelFill,
      fillOpacity: 1,
      stroke: SEQUENCE_THEME.branchLabelStroke,
      strokeWidth: 0.9,
      strokeOpacity: 0.95
    })
  );
  state.layers.texts.push(
    svgMultilineText(labelLines, left + 22, top + 14, {
      fontSize: state.candidate.blockFontSize,
      lineHeight: state.candidate.blockFontSize + 4,
      fill: SEQUENCE_THEME.blockText,
      weight: 560,
      letterSpacing: 0.15
    })
  );

  for (const dividerY of dividers) {
    state.layers.blockForegrounds.push(
      svgLine(left + 10, dividerY, right - 10, dividerY, {
        stroke: SEQUENCE_THEME.blockStroke,
        strokeWidth: 0.8,
        strokeOpacity: 0.55,
        dashed: true
      })
    );
  }

  return bottom + state.candidate.branchGap;
}

function closeOpenActivationBars(state, endY) {
  for (const lane of state.lanes) {
    const stack = state.activationState.get(lane.alias) ?? [];
    while (stack.length > 0) {
      const activeBar = stack.pop();
      state.layers.activationBars.push(drawActivationBar(lane, activeBar.startY, endY, activeBar.level));
    }
    state.activationState.set(lane.alias, stack);
  }
}

function drawActivationBar(lane, startY, endY, level) {
  const barWidth = 12;
  const levelOffset = level * 4;
  const x = lane.center - barWidth / 2 + levelOffset;
  const y = Math.min(startY, endY);
  const height = Math.max(18, Math.abs(endY - startY));
  return svgRect(x, y, barWidth, height, {
    rx: 6,
    ry: 6,
    fill: "#f8fafc",
    fillOpacity: 1,
    stroke: "#cbd5e1",
    strokeWidth: 0.9,
    strokeOpacity: 0.95
  });
}

function drawParticipantBox(placement, lines, candidate) {
  const lineHeight = candidate.headerFontSize + 5;
  const textCenterX = placement.x + placement.width / 2;
  const firstLineY =
    placement.y + (placement.height - lineHeight * lines.length) / 2 + lineHeight / 2 + 1.5;
  return [
    svgRect(placement.x, placement.y, placement.width, placement.height, {
      rx: 10,
      ry: 10,
      fill: SEQUENCE_THEME.participantFill,
      fillOpacity: 1,
      stroke: SEQUENCE_THEME.participantStroke,
      strokeWidth: 0
    }),
    lines
      .map((line, index) =>
        svgText(line, textCenterX, firstLineY + index * lineHeight, {
          fontSize: candidate.headerFontSize,
          fill: SEQUENCE_THEME.participantText,
          anchor: "middle",
          baseline: "middle",
          weight: 700,
          letterSpacing: 0.1
        })
      )
      .join("")
  ].join("");
}

function renderSequenceSvg(layout, candidate, profile) {
  const body = [
    ...layout.layers.lifelines,
    ...layout.layers.activationBars,
    ...layout.layers.blockBackgrounds,
    ...layout.layers.boxes,
    ...layout.layers.notes,
    ...layout.layers.blockForegrounds,
    ...layout.layers.arrows,
    ...layout.layers.badges,
    ...layout.layers.texts
  ].join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${profile.pageWidthPx}" height="${layout.outputHeight}" viewBox="0 0 ${layout.intrinsicWidth} ${layout.intrinsicHeight}" preserveAspectRatio="xMidYMin meet" font-family="${SEQUENCE_FONT_STACK}" shape-rendering="geometricPrecision" text-rendering="optimizeLegibility">`,
    `<defs>${svgArrowMarker()}</defs>`,
    svgRect(0, 0, layout.intrinsicWidth, layout.intrinsicHeight, { fill: profile.background, stroke: "none" }),
    body,
    "</svg>"
  ].join("");
}

async function launchBrowser(profile) {
  const profileDir = await createTemporaryBrowserProfile();
  const browser = await puppeteer.launch({
    executablePath: profile.chromeExecutablePath,
    headless: true,
    args: buildChromeLaunchArgs(profileDir)
  });

  return {
    browser,
    cleanup: async () => {
      await removeTemporaryBrowserProfile(profileDir);
    }
  };
}

async function lockDownPage(page, profile) {
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (isLocalBrowserRequest(request.url())) {
      request.continue().catch(() => {});
      return;
    }

    request.abort("blockedbyclient").catch(() => {});
  });

  await page.setViewport({
    width: Math.max(profile.pageWidthPx * 2, 1280),
    height: profile.maxRenderedHeightPx + 1200,
    deviceScaleFactor: 2
  });
}

async function renderPng(page, svg, profile) {
  await page.setContent(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          html, body {
            margin: 0;
            padding: 0;
            background: ${profile.background};
          }

          #frame {
            width: ${profile.pageWidthPx}px;
            display: inline-block;
            background: ${profile.background};
          }

          #frame svg {
            display: block;
          }
        </style>
      </head>
      <body>
        <div id="frame">${svg}</div>
      </body>
    </html>
  `);

  const frame = await page.$("#frame");
  if (!frame) {
    throw new Error("Unable to create PNG frame.");
  }

  return frame.screenshot({ type: "png" });
}

function svgRect(x, y, width, height, options = {}) {
  const attrs = {
    x: round(x),
    y: round(y),
    width: round(width),
    height: round(height),
    rx: options.rx,
    ry: options.ry,
    fill: options.fill,
    stroke: options.stroke,
    "stroke-width": options.strokeWidth,
    "stroke-opacity": options.strokeOpacity,
    "fill-opacity": options.fillOpacity
  };
  return `<rect ${serializeAttributes(attrs)} />`;
}

function svgLine(x1, y1, x2, y2, options = {}) {
  const attrs = {
    x1: round(x1),
    y1: round(y1),
    x2: round(x2),
    y2: round(y2),
    stroke: options.stroke,
    "stroke-width": options.strokeWidth,
    "stroke-opacity": options.strokeOpacity,
    "stroke-dasharray": options.dashed ? "5 4" : undefined,
    "marker-end": options.markerEnd
  };
  return `<line ${serializeAttributes(attrs)} />`;
}

function svgPath(d, options = {}) {
  const attrs = {
    d,
    fill: options.fill,
    stroke: options.stroke,
    "stroke-width": options.strokeWidth,
    "stroke-opacity": options.strokeOpacity,
    "stroke-dasharray": options.dashed ? "5 4" : undefined,
    "marker-end": options.markerEnd
  };
  return `<path ${serializeAttributes(attrs)} />`;
}

function svgCircle(cx, cy, r, options = {}) {
  const attrs = {
    cx: round(cx),
    cy: round(cy),
    r: round(r),
    fill: options.fill,
    stroke: options.stroke,
    "stroke-width": options.strokeWidth,
    "fill-opacity": options.fillOpacity
  };
  return `<circle ${serializeAttributes(attrs)} />`;
}

function svgText(text, x, y, options = {}) {
  const attrs = {
    x: round(x),
    y: round(y),
    "text-anchor": options.anchor ?? "start",
    "dominant-baseline": options.baseline ?? "hanging",
    "font-family": options.fontFamily ?? SEQUENCE_FONT_STACK,
    "font-size": options.fontSize,
    "font-weight": options.weight ?? 500,
    "letter-spacing": options.letterSpacing,
    fill: options.fill
  };
  return `<text ${serializeAttributes(attrs)}>${escapeXml(text)}</text>`;
}

function svgMultilineText(lines, x, y, options = {}) {
  const attrs = {
    x: round(x),
    y: round(y),
    "text-anchor": options.anchor ?? "start",
    "dominant-baseline": "hanging",
    "font-family": options.fontFamily ?? SEQUENCE_FONT_STACK,
    "font-size": options.fontSize,
    "font-weight": options.weight ?? 400,
    "letter-spacing": options.letterSpacing,
    fill: options.fill
  };
  const content = lines
    .map((line, index) => {
      const tspanAttrs = {
        x: round(x),
        dy: index === 0 ? 0 : options.lineHeight
      };
      return `<tspan ${serializeAttributes(tspanAttrs)}>${escapeXml(line)}</tspan>`;
    })
    .join("");
  return `<text ${serializeAttributes(attrs)}>${content}</text>`;
}

function svgArrowMarker() {
  return `<marker id="${ARROW_MARKER_ID}" markerWidth="12" markerHeight="12" refX="10" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M 1 0.75 L 10 4 L 1 7.25" fill="none" stroke="${SEQUENCE_THEME.arrowStroke}" stroke-opacity="1" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" /></marker>`;
}

function serializeAttributes(attributes) {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}="${escapeXml(String(value))}"`)
    .join(" ");
}

function wrapText(text, maxWidth, fontSize, maxLines) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [""];
  }

  const lines = [];
  let current = words[0];

  for (const word of words.slice(1)) {
    const candidate = `${current} ${word}`;
    if (measureTextWidth(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }

    lines.push(current);
    current = word;
  }

  lines.push(current);

  while (lines.length > maxLines) {
    const merged = [...lines.slice(0, maxLines - 1), lines.slice(maxLines - 1).join(" ")];
    lines.length = 0;
    lines.push(...rebalanceWrappedLines(merged, maxWidth, fontSize));
    if (lines.length <= maxLines) {
      break;
    }
    const overflow = lines.pop();
    lines[lines.length - 1] = `${lines.at(-1)} ${overflow}`.trim();
  }

  return lines;
}

function rebalanceWrappedLines(lines, maxWidth, fontSize) {
  const rebalanced = [];
  for (const line of lines) {
    if (measureTextWidth(line, fontSize) <= maxWidth) {
      rebalanced.push(line);
      continue;
    }

    const words = line.split(/\s+/).filter(Boolean);
    let current = words.shift() ?? "";
    for (const word of words) {
      const candidate = `${current} ${word}`;
      if (measureTextWidth(candidate, fontSize) <= maxWidth) {
        current = candidate;
      } else {
        rebalanced.push(current);
        current = word;
      }
    }
    rebalanced.push(current);
  }
  return rebalanced;
}

function measureTextWidth(text, fontSize) {
  let width = 0;
  for (const char of text) {
    if (char === " ") {
      width += fontSize * 0.34;
    } else if (/[A-Z0-9]/.test(char)) {
      width += fontSize * 0.62;
    } else if (/[mwMW]/.test(char)) {
      width += fontSize * 0.7;
    } else if (/[ilI.,]/.test(char)) {
      width += fontSize * 0.3;
    } else {
      width += fontSize * 0.56;
    }
  }
  return width;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
