import Foundation

/// The native landing: the election's prerendered landing page, with the states that apply taken
/// from `/states/landing` (ADR 0019 D4b).
///
/// The landing page is prerendered for the election's stage on the day of the build, in a first
/// visit's state. The stage can change while an app version is in use, and a returning voter has a
/// quiz to resume or a comparison to see — so the lede, the steps and the call to action are
/// replaced with the states page's rendering of the stage the engine reports and the voter's
/// progress. Every word is still the web's; this only chooses among them.
enum LandingComposition {
    enum Progress: Equatable {
        case fresh
        case partway(next: Int, total: Int)
        case complete

        var slot: NativeDocument.Slot {
            switch self {
            case .fresh: return .landingFresh
            case .partway: return .landingResume
            case .complete: return .landingComplete
            }
        }

        /// The voter's own values for the call to action's marked numbers.
        var values: [String: String] {
            guard case let .partway(next, total) = self else { return [:] }
            return ["next": String(next), "total": String(total)]
        }
    }

    enum Failure: Error, CustomStringConvertible {
        case missing(String)

        var description: String {
            switch self {
            case let .missing(what): return "the landing has no \(what)"
            }
        }
    }

    /// The theme toggle's accessible name in each theme, from the states page.
    struct ThemeLabels: Equatable {
        let light: String
        let dark: String
    }

    /// The landing to draw: `landing` with its stage parts and call to action replaced.
    static func compose(
        landing: NativeDocument,
        states: NativeDocument,
        electionID: String,
        phase: String,
        progress: Progress
    ) throws -> NativeDocument {
        // The page must be this election's own landing: another's would lend it its picker.
        guard prerenderedPhase(of: landing, electionID: electionID) != nil else {
            throw Failure.missing("the landing of \(electionID)")
        }
        let stateSections = sections(in: states.blocks)
        let stateSlots = slots(in: states.blocks)
        func replace(_ block: NativeDocument.Block) throws -> NativeDocument.Block {
            switch block {
            case let .section(.stage, id?, _):
                let part = id.split(separator: "-").first.map(String.init) ?? id
                let wanted = "\(part)-\(electionID)-\(phase)"
                guard let state = stateSections[wanted] else { throw Failure.missing("section \(wanted)") }
                return state
            case .slot(.landingFresh, _):
                guard case let .slot(slot, controls)? = stateSlots[progress.slot] else {
                    throw Failure.missing("call to action \(progress.slot.rawValue)")
                }
                return .slot(slot, controls: try fill(controls, with: progress.values))
            case let .section(role, id, content):
                return .section(role: role, id: id, content: try content.map(replace))
            default:
                return block
            }
        }
        return NativeDocument(
            route: landing.route,
            title: landing.title,
            crumbs: landing.crumbs,
            crumbsLabel: landing.crumbsLabel,
            top: landing.top,
            brand: landing.brand,
            blocks: try landing.blocks.map(replace),
            digest: "",
            spoken: "",
            drawn: ""
        )
    }

    /// The call to action with the voter's own values in place of the page's samples. A value the
    /// page marks and the voter's progress does not give — or one given that the page does not mark —
    /// is a failure, never the sample drawn in its place.
    private static func fill(_ controls: [NativeDocument.Control], with values: [String: String]) throws
        -> [NativeDocument.Control] {
        let marked = Set(controls.flatMap(\.values.keys))
        guard marked == Set(values.keys) else {
            throw Failure.missing("values \(values.keys.sorted()) where the page marks \(marked.sorted())")
        }
        return controls.map { control in
            NativeDocument.Control(
                label: control.label,
                action: control.action,
                href: control.href,
                values: values.filter { control.values.keys.contains($0.key) },
                named: control.named
            )
        }
    }

    static func themeLabels(in states: NativeDocument) throws -> ThemeLabels {
        let found = slots(in: states.blocks)
        guard case let .slot(_, light)? = found[.themeLight], let lightLabel = light.first?.label,
              case let .slot(_, dark)? = found[.themeDark], let darkLabel = dark.first?.label
        else { throw Failure.missing("theme labels") }
        return ThemeLabels(light: lightLabel, dark: darkLabel)
    }

    /// The stage the landing page was prerendered for, from its own stage section.
    static func prerenderedPhase(of landing: NativeDocument, electionID: String) -> String? {
        for case let .section(.stage, id?, _) in landing.blocks {
            let prefix = "lede-\(electionID)-"
            if id.hasPrefix(prefix) { return String(id.dropFirst(prefix.count)) }
        }
        return nil
    }

    private static func sections(in blocks: [NativeDocument.Block]) -> [String: NativeDocument.Block] {
        var out: [String: NativeDocument.Block] = [:]
        for block in blocks {
            if case let .section(.stage, id?, _) = block { out[id] = block }
        }
        return out
    }

    private static func slots(in blocks: [NativeDocument.Block]) -> [NativeDocument.Slot: NativeDocument.Block] {
        var out: [NativeDocument.Slot: NativeDocument.Block] = [:]
        for block in blocks {
            if case let .slot(slot, _) = block { out[slot] = block }
        }
        return out
    }
}
