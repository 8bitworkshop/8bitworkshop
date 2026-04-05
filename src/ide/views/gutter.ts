import { Compartment, Extension, RangeSet, StateEffect, StateField } from "@codemirror/state";
import { gutter, GutterMarker, ViewPlugin } from "@codemirror/view";
import { hex } from "../../common/util";
import { isMobileDevice } from "./baseviews";

const setOffset = StateEffect.define<Map<number, number>>();
const setBytes = StateEffect.define<Map<number, string>>();
const setClock = StateEffect.define<Map<number, string>>();
const toggleBreakpoint = StateEffect.define<number | null>();
const setErrors = StateEffect.define<Map<number, string>>();
const setCurrentPc = StateEffect.define<number | null>();
const runToLineEffect = StateEffect.define<number>();

const showErrorMessage = StateEffect.define<{ line: number, msg: string, toggle?: boolean } | null>();

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
                        ranges.push(new OffsetMarker(hex(val, 4)).range(pos));
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
            if (e.is(toggleBreakpoint)) {
                if (e.value === null) {
                    value = RangeSet.empty;
                } else {
                    const line = e.value;
                    if (line >= 1 && line <= tr.state.doc.lines) {
                        const pos = tr.state.doc.line(line).from;
                        let hasBreakpoint = false;
                        value.between(pos, pos, () => { hasBreakpoint = true; return false; });
                        if (hasBreakpoint) {
                            value = value.update({ filter: from => from !== pos });
                        } else {
                            value = value.update({ add: [BREAKPOINT_MARKER.range(pos)] });
                        }
                    }
                }
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
                for (let [line, msg] of map.entries()) {
                    if (line >= 1 && line <= tr.state.doc.lines) {
                        const pos = tr.state.doc.line(line).from;
                        ranges.push(new ErrorMarker(line, msg).range(pos));
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
    toDOM() { return document.createTextNode(this.hex); }
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
        span.textContent = "●";
        span.style.color = "transparent";
        span.style.cursor = "pointer";
        span.addEventListener("mouseenter", () => {
            span.style.color = "rgba(255, 0, 0, 0.5)";
        });
        span.addEventListener("mouseleave", () => {
            span.style.color = "transparent";
        });
        return span;
    }
};

const BREAKPOINT_MARKER = new class extends GutterMarker {
    toDOM() {
        const span = document.createElement("span");
        span.innerHTML = "●";
        span.style.color = "rgba(255, 0, 0, 1.0)";
        span.style.cursor = "pointer";
        span.title = "Click to run to here"; // "Click to toggle breakpoint";
        return span;
    }
};

class ErrorMarker extends GutterMarker {
    constructor(readonly line: number, readonly msg: string) { super(); }

    toDOM() {
        const span = document.createElement("span");
        span.innerHTML = "ⓧ";
        span.style.color = "red";
        span.style.cursor = "pointer";
        span.title = this.msg;
        return span;
    }
    eq(other: ErrorMarker) { return this.line == other.line && this.msg == other.msg; }
}

const CURRENT_PC_PLACEHOLDER_MARKER = new class extends GutterMarker {
    toDOM() {
        const span = document.createElement("span");
        span.textContent = "▶";
        span.style.color = "transparent";
        span.style.cursor = "pointer";
        span.title = "Click to run to here";
        span.addEventListener("mouseenter", () => {
            span.style.color = "#ffee66";
        });
        span.addEventListener("mouseleave", () => {
            span.style.color = "transparent";
        });
        return span;
    }
};

const CURRENT_PC_MARKER = new class extends GutterMarker {
    toDOM() {
        const span = document.createElement("span");
        span.innerHTML = "▶";
        span.style.color = "#ff66ee";
        span.style.cursor = "pointer";
        span.title = "Current PC";
        return span;
    }
};

const offsetGutter = gutter({
    class: "gutter-offset",
    markers: v => v.state.field(offsetField),
    initialSpacer: () => new OffsetMarker("0000")
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
                errorMarkers.between(pos, pos, (from, to, marker: ErrorMarker) => {
                    msg = marker.msg;
                });
                if (msg) {
                    const lineNum = view.state.doc.lineAt(line.from).number;
                    view.dispatch({
                        effects: showErrorMessage.of({ line: lineNum, msg, toggle: true })
                    });
                }
            } else {
                const lineNum = view.state.doc.lineAt(line.from).number;
                view.dispatch({
                    effects: toggleBreakpoint.of(lineNum)
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
    set: toggleBreakpoint,
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

export function gutterLineInfo(isOrIncludesAsm: boolean, alwaysHide: boolean): Extension {
    const compartment = new Compartment();

    const gutters = (): Extension => {
        const hide = alwaysHide || isMobileDevice;
        return [
            !hide ? [offsetField, offsetGutter] : [],
            isOrIncludesAsm && !hide ? [bytesField, bytesGutter, clockField, clockGutter] : [],
        ];
    };

    return [
        compartment.of(gutters()),
        ViewPlugin.define(view => {
            const onResize = () => view.dispatch({ effects: compartment.reconfigure(gutters()) });
            window.addEventListener("resize", onResize);
            return { destroy() { window.removeEventListener("resize", onResize); } };
        }),
    ];
}
