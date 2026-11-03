import { RangeSet, StateEffect, StateField } from "@codemirror/state";
import { gutter, GutterMarker } from "@codemirror/view";
import { canUseBreakpoints } from "../breakpoints";

const setOffset = StateEffect.define<Map<number, string>>();
const setBytes = StateEffect.define<Map<number, string>>();
const setClock = StateEffect.define<Map<number, string>>();
// clicking the gutter only *requests* a toggle; the breakpoint store
// (breakpoints.ts) decides the new state and syncs it back via setAll
const requestToggleBreakpoint = StateEffect.define<number>();
const setAllBreakpoints = StateEffect.define<{ line: number, enabled: boolean }[]>();
/** the message for a line; a warning is marked differently but doesn't fail the build */
export interface ErrorInfo {
    msg: string, warning?: boolean,
    /** the tool's `= help:` lines and help-page topic, if it gave any */
    help?: string[], topic?: string
}

const setErrors = StateEffect.define<Map<number, ErrorInfo>>();
const setCurrentPc = StateEffect.define<number | null>();
const runToLineEffect = StateEffect.define<number>();

const showErrorMessage = StateEffect.define<{ line: number, msg: string, warning?: boolean, help?: string[], topic?: string, toggle?: boolean } | null>();

const offsetField = StateField.define<RangeSet<GutterMarker>>({
    create() { return RangeSet.empty; },
    update(value, tr) {
        value = value.map(tr.changes);
        for (let e of tr.effects) {
            if (e.is(setOffset)) {
                const map = e.value;
                const ranges = [];
                for (let [line, val] of map.entries()) {
                    if (line >= 1 && line <= tr.state.doc.lines) {
                        const pos = tr.state.doc.line(line).from;
                        ranges.push(new OffsetMarker(val).range(pos));
                    }
                }
                value = RangeSet.of(ranges, true);
            }
        }
        return value;
    },
});

const bytesField = StateField.define<RangeSet<GutterMarker>>({
    create() { return RangeSet.empty; },
    update(value, tr) {
        value = value.map(tr.changes);
        for (let e of tr.effects) {
            if (e.is(setBytes)) {
                const map = e.value;
                const ranges = [];
                for (let [line, val] of map.entries()) {
                    if (line >= 1 && line <= tr.state.doc.lines) {
                        const pos = tr.state.doc.line(line).from;
                        ranges.push(new BytesMarker(val).range(pos));
                    }
                }
                value = RangeSet.of(ranges, true);
            }
        }
        return value;
    },
});

const clockField = StateField.define<RangeSet<GutterMarker>>({
    create() { return RangeSet.empty; },
    update(value, tr) {
        value = value.map(tr.changes);
        for (let e of tr.effects) {
            if (e.is(setClock)) {
                const map = e.value;
                const ranges = [];
                for (let [line, val] of map.entries()) {
                    if (line >= 1 && line <= tr.state.doc.lines) {
                        const pos = tr.state.doc.line(line).from;
                        ranges.push(new ClockMarker(val).range(pos));
                    }
                }
                value = RangeSet.of(ranges, true);
            }
        }
        return value;
    },
});

const breakpointField = StateField.define<RangeSet<GutterMarker>>({
    create() { return RangeSet.empty; },
    update(value, tr) {
        value = value.map(tr.changes);
        for (let e of tr.effects) {
            if (e.is(setAllBreakpoints)) {
                // replace the whole marker set with the store's state for this file
                const ranges = [];
                const bps = e.value.filter(bp => bp.line >= 1 && bp.line <= tr.state.doc.lines)
                    .sort((a, b) => a.line - b.line);
                for (let bp of bps) {
                    const pos = tr.state.doc.line(bp.line).from;
                    ranges.push((bp.enabled ? BREAKPOINT_MARKER : DISABLED_BREAKPOINT_MARKER).range(pos));
                }
                value = RangeSet.of(ranges, true);
            }
        }
        return value;
    },
});

const errorField = StateField.define<RangeSet<GutterMarker>>({
    create() { return RangeSet.empty; },
    update(value, tr) {
        value = value.map(tr.changes);
        for (let e of tr.effects) {
            if (e.is(setErrors)) {
                const map = e.value;
                const ranges = [];
                for (let [line, info] of map.entries()) {
                    if (line >= 1 && line <= tr.state.doc.lines) {
                        const pos = tr.state.doc.line(line).from;
                        ranges.push(new ErrorMarker(line, info.msg, info.warning, info.help, info.topic).range(pos));
                    }
                }
                value = RangeSet.of(ranges, true);
            }
        }
        return value;
    },
});

const currentPcField = StateField.define<RangeSet<GutterMarker>>({
    create() { return RangeSet.empty; },
    update(value, tr) {
        value = value.map(tr.changes);
        for (let e of tr.effects) {
            if (e.is(setCurrentPc)) {
                if (e.value === null) {
                    value = RangeSet.empty;
                } else {
                    const line = e.value;
                    if (line >= 1 && line <= tr.state.doc.lines) {
                        const pos = tr.state.doc.line(line).from;
                        value = RangeSet.of(CURRENT_PC_MARKER.range(pos));
                    }
                }
            }
        }
        return value;
    },
});

class OffsetMarker extends GutterMarker {
    constructor(readonly hex: string) { super(); }
    toDOM() {
        const span = document.createElement("span");
        span.className = "gutter-offset-marker";
        span.textContent = this.hex;
        span.title = "Click to run to here";
        return span;
    }
    eq(other: OffsetMarker) { return this.hex == other.hex; }
}

class BytesMarker extends GutterMarker {
    constructor(readonly bytes: string) { super(); }
    toDOM() { return document.createTextNode(this.bytes); }
    eq(other: BytesMarker) { return this.bytes == other.bytes; }
}

class ClockMarker extends GutterMarker {
    constructor(readonly clock: string) { super(); }
    toDOM() { return document.createTextNode(this.clock); }
    eq(other: ClockMarker) { return this.clock == other.clock; }
}

const BREAKPOINT_PLACEHOLDER_MARKER = new class extends GutterMarker {
    toDOM() {
        const span = document.createElement("span");
        span.className = "gutter-breakpoint-placeholder";
        span.textContent = "●";
        return span;
    }
};

class BreakpointMarker extends GutterMarker {
    constructor(readonly enabled: boolean) { super(); }
    toDOM() {
        const span = document.createElement("span");
        span.className = "gutter-breakpoint " + (this.enabled ? "gutter-breakpoint-enabled" : "gutter-breakpoint-disabled");
        span.innerHTML = "●";
        span.title = this.enabled ? "Breakpoint (click to remove; manage in Breakpoints window)" : "Disabled breakpoint (click to remove)";
        return span;
    }
    eq(other: BreakpointMarker) { return this.enabled == other.enabled; }
}

const BREAKPOINT_MARKER = new BreakpointMarker(true);
const DISABLED_BREAKPOINT_MARKER = new BreakpointMarker(false);

class ErrorMarker extends GutterMarker {
    constructor(readonly line: number, readonly msg: string, readonly warning?: boolean,
        readonly help?: string[], readonly topic?: string) { super(); }

    toDOM() {
        const span = document.createElement("span");
        span.className = this.warning ? "gutter-warning" : "gutter-error";
        span.innerHTML = this.warning ? "⚠" : "ⓧ";
        span.title = [this.msg, ...(this.help || []).map((h) => "= help: " + h)].join("\n");
        return span;
    }
    eq(other: ErrorMarker) {
        return this.line == other.line && this.msg == other.msg && this.warning == other.warning
            && this.topic == other.topic && this.help === other.help;
    }
}

const CURRENT_PC_PLACEHOLDER_MARKER = new class extends GutterMarker {
    toDOM() {
        const span = document.createElement("span");
        span.className = "gutter-currentpc-placeholder";
        span.textContent = "▶";
        span.title = "Click to run to here";
        return span;
    }
};

const CURRENT_PC_MARKER = new class extends GutterMarker {
    toDOM() {
        const span = document.createElement("span");
        span.className = "gutter-currentpc";
        span.innerHTML = "▶";
        span.title = "Current PC";
        return span;
    }
};

const offsetGutter = gutter({
    class: "gutter-offset",
    markers: v => v.state.field(offsetField),
    initialSpacer: () => new OffsetMarker("0000"),
    domEventHandlers: {
        click(view, line) {
            const lineNum = view.state.doc.lineAt(line.from).number;
            view.dispatch({
                effects: runToLineEffect.of(lineNum)
            });
            return true;
        }
    }
});

const bytesGutter = gutter({
    class: "gutter-bytes",
    markers: v => v.state.field(bytesField),
    initialSpacer: () => new BytesMarker("00 00 00")
});

const clockGutter = gutter({
    class: "gutter-clock",
    markers: v => v.state.field(clockField),
    initialSpacer: () => new ClockMarker("00")
});

const statusGutter = gutter({
    class: "gutter-status",
    lineMarker(view, line, otherMarkers) {
        // Show invisible placeholder on lines without markers, to enable hover.
        return otherMarkers.length === 0 ? BREAKPOINT_PLACEHOLDER_MARKER : null;
    },
    markers: v => {
        const errorMarkers = v.state.field(errorField);
        if (errorMarkers.size > 0) {
            return errorMarkers;
        }
        return v.state.field(breakpointField);
    },
    initialSpacer: () => new ErrorMarker(0, "ⓧ"), // "ⓧ" is wider than "●".
    domEventHandlers: {
        click(view, line) {
            const errorMarkers = view.state.field(errorField);
            if (errorMarkers.size > 0) {
                const pos = line.from;
                let msg = "";
                let warning = false;
                let help: string[] | undefined;
                let topic: string | undefined;
                errorMarkers.between(pos, pos, (from, to, marker: ErrorMarker) => {
                    msg = marker.msg;
                    warning = marker.warning === true;
                    help = marker.help;
                    topic = marker.topic;
                });
                if (msg) {
                    const lineNum = view.state.doc.lineAt(line.from).number;
                    view.dispatch({
                        effects: showErrorMessage.of({ line: lineNum, msg, warning, help, topic, toggle: true })
                    });
                }
            } else if (canUseBreakpoints()) {
                const lineNum = view.state.doc.lineAt(line.from).number;
                view.dispatch({
                    effects: requestToggleBreakpoint.of(lineNum)
                });
            }
            return true;
        }
    }
});

const currentPcGutter = gutter({
    class: "gutter-currentpc",
    lineMarker(view, line, otherMarkers) {
        // Show invisible placeholder on lines without markers, to enable hover.
        return otherMarkers.length === 0 ? CURRENT_PC_PLACEHOLDER_MARKER : null;
    },
    markers: v => v.state.field(currentPcField),
    initialSpacer: () => CURRENT_PC_MARKER,
    domEventHandlers: {
        click(view, line) {
            const lineNum = view.state.doc.lineAt(line.from).number;
            view.dispatch({
                effects: runToLineEffect.of(lineNum)
            });
            return true;
        }
    }
});

export const offset = {
    set: setOffset,
    field: offsetField,
    gutter: offsetGutter,
};

export const bytes = {
    set: setBytes,
    field: bytesField,
    gutter: bytesGutter,
};

export const clock = {
    set: setClock,
    field: clockField,
    gutter: clockGutter,
};

export const breakpointMarkers = {
    requestToggle: requestToggleBreakpoint,
    setAll: setAllBreakpoints,
    field: breakpointField,
};

export const errorMarkers = {
    set: setErrors,
    field: errorField,
    showMessage: showErrorMessage
};

export const statusMarkers = {
    gutter: statusGutter
};

export const currentPcMarker = {
    set: setCurrentPc,
    runToLine: runToLineEffect,
    field: currentPcField,
    gutter: currentPcGutter,
};
