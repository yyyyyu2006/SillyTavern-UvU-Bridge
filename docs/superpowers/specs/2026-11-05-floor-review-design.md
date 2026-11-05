# Floor-based scene review

User scope: one review item per Tavern message floor, explicit story-tag extraction, per-scene select-all and editable review, approved text usable through the existing journal/memory gate. User asks to implement and keep original prompt/reply flows.

Approach: preserve each original message boundary as additive floor metadata on existing checked multipart scene events. Keep text readable for older clients; new clients regroup transport parts into whole floors. A JSON-only transcript would break older review readers, and blank-line splitting loses source boundaries.

Extract recognized explicit story wrappers (content, maintext, story and documented aliases) after removing known non-story containers. Support custom body tags because presets define arbitrary markup. Paired story wrappers take precedence over all outside text; malformed recognized wrappers do not silently export the whole message. Untagged prose is retained for manual review with a warning. This is deterministic extraction, not a claim of universal semantic recognition. Never call an extra model or alter source messages.

Keep reviewed and user-edited legacy memories intact. New review entries default unchecked. Old transcripts with timestamp headers can be regrouped on an explicit action; legacy tags already stripped cannot be recovered and require a fresh export for precise filtering.

UI: each scene has select-all (indeterminate support), floor count/selection, compact collapsed rows, floor labels and an editable textarea on expansion. Save only selected edited text into the same journal record; mark category Tavern offline story and timeline; keep original source for comparison and existing per-character/archive review gate. No duplicate memory database.

Constraints: preserve source prompt/context files, source chats and existing CSS. Preserve mixed line endings. Existing task checkouts and authorized direct main push are retained. Scope excludes universal preset guarantees and automatic changes to approved memories.

Evidence: official Tavern release public/script.js uses message.mes as the message source and messageFormatting for display (https://github.com/SillyTavern/SillyTavern/blob/release/public/script.js). No canonical finite preset story-tag registry was found; aliases are bridge compatibility heuristics, configurable by user.
