"""Hand-curated, verified fractions sample content (ARCHITECTURE.md section 13).

Guarantees that the sample demo never depends on external LLM quota,
and implements the exact signature demo: same wrong answer, different reasons.
"""

from __future__ import annotations

SAMPLE_DOC_TITLE = "Fractions: Parts, Comparisons & Operations"

SAMPLE_TEXT = """Page 1: Equal Parts of a Whole
A fraction represents a part of a whole. When a whole object or group is divided into equal parts, each part is a fraction of the whole.
The bottom number is called the denominator. It tells us how many equal parts the whole has been divided into.
The top number is called the numerator. It tells us how many of those equal parts we are considering.
For example, in 3/4, the whole is divided into 4 equal parts, and we take 3 of them.
Crucially, all parts must be strictly equal in size. If a pizza is sliced into uneven pieces, the pieces are not fractions in the mathematical sense.

Page 2: Unit Fractions and Part Size
A unit fraction is a fraction with a numerator of 1, such as 1/2, 1/3, 1/4, 1/8, or 1/10.
Notice what happens to the size of each part as the denominator grows larger:
When you share a cake among 2 people, each person gets 1/2.
When you share that same cake among 8 people, each person gets only 1/8.
Because the same whole is divided into more pieces, each individual piece becomes smaller!
Therefore: A larger denominator means smaller parts. For unit fractions, 1/8 is much smaller than 1/4, and 1/10 is smaller than 1/2.

Page 3: Comparing Fractions
When comparing fractions, you must consider both the numerator and the denominator.
Case 1: Same Denominators (Like Denominators)
When denominators are the same, parts are the same size. So compare the numerators: 3/5 is larger than 2/5 because 3 parts are more than 2 parts.
Case 2: Same Numerators
When numerators are equal, compare denominators. The fraction with the smaller denominator has larger parts: 2/3 is greater than 2/7 because thirds are bigger than sevenths.
Case 3: Different Numerators and Denominators
To compare 2/3 and 3/8, convert them to equivalent fractions with a common denominator. The common denominator of 3 and 8 is 24.
2/3 = 16/24
3/8 = 9/24
Since 16/24 > 9/24, 2/3 is greater than 3/8.
Common Trap: Never assume that a fraction with bigger numbers is always larger. In 3/8, the 8 means very small pieces, so 3/8 is less than half, while 2/3 is more than half!

Page 4: Equivalent Fractions
Fractions that represent the same value or amount of a whole are called equivalent fractions.
For instance, 1/2, 2/4, 3/6, and 4/8 all represent the exact same amount.
To find an equivalent fraction, multiply or divide both the numerator and the denominator by the exact same non-zero number.
For example: (2 * 4) / (3 * 4) = 8/12. So 2/3 and 8/12 are equivalent.
Simplifying a fraction means dividing numerator and denominator by their greatest common factor until no common factor remains.

Page 5: Adding and Subtracting Fractions
To add or subtract fractions, the parts must be of equal size. That means they MUST have the same denominator!
If denominators are the same: add the numerators and keep the denominator unchanged.
1/5 + 2/5 = 3/5.
Never add the denominators! If you have 1 slice of a 5-slice pizza and get 2 more slices of that pizza, you have 3 slices of a 5-slice pizza (3/5), NOT 3 slices of a 10-slice pizza (3/10).
If denominators are different: first find a common denominator using equivalent fractions, then add numerators.
"""

SAMPLE_CONCEPTS = [
    {
        "id": "c_parts_of_whole",
        "conceptId": "c_parts_of_whole",
        "name": "Equal Parts of a Whole",
        "description": "Understanding numerator as parts taken and denominator as total equal parts.",
        "prerequisites": [],
        "sourceRefs": [{"chunk_id": "c0", "page": 1, "quote": "The bottom number is called the denominator. It tells us how many equal parts the whole has been divided into."}],
        "catalogStatus": "ready",
        "misconceptions": [
            {
                "id": "M1",
                "label": "Unequal parts can form fractions",
                "description": "Believing any pieces of a whole count as fractions even if not equally divided.",
                "preferred_strategies": ["analogy_visual", "simplified"],
            }
        ],
    },
    {
        "id": "c_unit_fractions",
        "conceptId": "c_unit_fractions",
        "name": "Unit Fractions & Part Size",
        "description": "Understanding that as the denominator increases, the size of each unit fraction piece decreases.",
        "prerequisites": ["c_parts_of_whole"],
        "sourceRefs": [{"chunk_id": "c1", "page": 2, "quote": "Because the same whole is divided into more pieces, each individual piece becomes smaller!"}],
        "catalogStatus": "ready",
        "misconceptions": [
            {
                "id": "M1",
                "label": "Larger denominator means larger unit fraction",
                "description": "Believing that 1/10 is larger than 1/5 because 10 is larger than 5.",
                "preferred_strategies": ["analogy_visual", "simplified", "worked_example"],
            }
        ],
    },
    {
        "id": "c_comparing_fractions",
        "conceptId": "c_comparing_fractions",
        "name": "Comparing Fractions",
        "description": "Comparing fractions with like and unlike numerators and denominators using common denominators.",
        "prerequisites": ["c_unit_fractions"],
        "sourceRefs": [{"chunk_id": "c2", "page": 3, "quote": "Never assume that a fraction with bigger numbers is always larger. In 3/8, the 8 means very small pieces"}],
        "catalogStatus": "ready",
        "misconceptions": [
            {
                "id": "M1",
                "label": "Larger denominator means larger fraction",
                "description": "Treating denominator as whole number magnitude rather than division into smaller pieces.",
                "preferred_strategies": ["analogy_visual", "simplified", "worked_example"],
            },
            {
                "id": "M2",
                "label": "Compare numerators only",
                "description": "Comparing only top numbers and ignoring denominator entirely.",
                "preferred_strategies": ["hint", "simplified", "worked_example"],
            },
            {
                "id": "M3",
                "label": "Additive difference reasoning",
                "description": "Believing fractions with equal gap between numerator and denominator are equal (e.g. 2/3 equals 3/4).",
                "preferred_strategies": ["worked_example", "analogy_visual", "prerequisite_review"],
            },
            {
                "id": "M4",
                "label": "Whole-number bias in operations",
                "description": "Adding numerators and denominators together.",
                "preferred_strategies": ["analogy_visual", "simplified", "worked_example"],
            },
        ],
    },
    {
        "id": "c_equivalent_fractions",
        "conceptId": "c_equivalent_fractions",
        "name": "Equivalent Fractions",
        "description": "Finding equal fractions by multiplying or dividing numerator and denominator by common factors.",
        "prerequisites": ["c_comparing_fractions"],
        "sourceRefs": [{"chunk_id": "c3", "page": 4, "quote": "Fractions that represent the same value or amount of a whole are called equivalent fractions."}],
        "catalogStatus": "ready",
        "misconceptions": [
            {
                "id": "M1",
                "label": "Additive change produces equivalent fraction",
                "description": "Believing adding the same number to numerator and denominator produces an equivalent fraction.",
                "preferred_strategies": ["worked_example", "analogy_visual"],
            }
        ],
    },
    {
        "id": "c_adding_fractions",
        "conceptId": "c_adding_fractions",
        "name": "Adding and Subtracting Fractions",
        "description": "Adding fractions with like denominators and converting unlike denominators.",
        "prerequisites": ["c_equivalent_fractions"],
        "sourceRefs": [{"chunk_id": "c4", "page": 5, "quote": "Never add the denominators! If you have 1 slice of a 5-slice pizza and get 2 more slices of that pizza, you have 3 slices of a 5-slice pizza"}],
        "catalogStatus": "ready",
        "misconceptions": [
            {
                "id": "M4",
                "label": "Whole-number bias in addition",
                "description": "Adding denominators together when adding fractions (e.g. 1/5 + 2/5 = 3/10).",
                "preferred_strategies": ["analogy_visual", "simplified", "worked_example"],
            }
        ],
    },
]

# Hand-verified question bank for sample notes
SAMPLE_QUESTIONS = [
    # 1. The Signature Probe Question
    {
        "id": "q_sample_probe",
        "concept_id": "c_comparing_fractions",
        "createdFor": "c_comparing_fractions",
        "kind": "probe",
        "stem": "Which of these two fractions is larger: 2/3 or 3/8?",
        "options": [
            {"id": "a", "text": "2/3 is larger", "signals": {}},
            {"id": "b", "text": "3/8 is larger", "signals": {"M1": 0.5, "M3": 0.4, "M2": 0.35}},
            {"id": "c", "text": "They are exactly equal", "signals": {"M3": 0.8}},
        ],
        "correct_option_id": "a",
        "rationale": "2/3 is greater than 1/2 (since 16/24 > 12/24), while 3/8 is less than 1/2 (since 9/24 < 12/24). Therefore 2/3 is larger.",
        "context_tag": "probe_unlike_fractions",
        "visual": {"type": "fraction_bar", "params": {"fractions": [{"num": 2, "den": 3, "label": "2/3"}, {"num": 3, "den": 8, "label": "3/8"}]}},
        "source_chunk_ids": ["c2"],
        "verified": True,
    },
    # 2. Discriminating Follow-Up (Separates M1, M2, and M3 when student picks option b)
    {
        "id": "q_sample_follow_up",
        "concept_id": "c_comparing_fractions",
        "createdFor": "c_comparing_fractions",
        "kind": "follow_up",
        "stem": "What led you to pick 3/8 as larger than 2/3?",
        "options": [
            {"id": "a", "text": "8 is a larger number than 3, so having 8 parts makes the fraction bigger.", "signals": {"M1": 0.95}},
            {"id": "b", "text": "The numerator 3 is bigger than 2, so 3 parts is always more than 2 parts.", "signals": {"M2": 0.95}},
            {"id": "c", "text": "I compared the gaps: 8 - 3 = 5, which is bigger than the gap of 3 - 2 = 1.", "signals": {"M3": 0.95}},
            {"id": "d", "text": "I converted to 24ths and compared 16/24 and 9/24.", "signals": {}},
        ],
        "correct_option_id": "d",
        "rationale": "To compare accurately, find equivalent fractions with common denominator 24.",
        "context_tag": "follow_up_reasoning",
        "visual": {"type": "none", "params": {}},
        "source_chunk_ids": ["c2"],
        "verified": True,
    },
    # 3. Practice Question (Post-Remediation)
    {
        "id": "q_sample_practice",
        "concept_id": "c_comparing_fractions",
        "createdFor": "c_comparing_fractions",
        "kind": "practice",
        "stem": "Which fraction is smaller: 1/5 or 1/10?",
        "options": [
            {"id": "a", "text": "1/10 is smaller", "signals": {}},
            {"id": "b", "text": "1/5 is smaller", "signals": {"M1": 0.85}},
            {"id": "c", "text": "They are equal", "signals": {"M2": 0.7}},
        ],
        "correct_option_id": "a",
        "rationale": "Dividing a whole into 10 equal parts yields smaller slices than dividing it into 5 equal parts. So 1/10 < 1/5.",
        "context_tag": "practice_unit_fractions",
        "visual": {"type": "fraction_bar", "params": {"fractions": [{"num": 1, "den": 5, "label": "1/5"}, {"num": 1, "den": 10, "label": "1/10"}]}},
        "source_chunk_ids": ["c1"],
        "verified": True,
    },
    # 4. Transfer Check Question (Different Context: Word Problem / Sharing)
    {
        "id": "q_sample_transfer",
        "concept_id": "c_comparing_fractions",
        "createdFor": "c_comparing_fractions",
        "kind": "transfer",
        "stem": "Priya ate 3/4 of a ribbon, while Arjun ate 5/8 of an identical ribbon. Who has more ribbon?",
        "options": [
            {"id": "a", "text": "Priya (3/4 is larger)", "signals": {}},
            {"id": "b", "text": "Arjun (5/8 is larger because 8 is bigger)", "signals": {"M1": 0.85}},
            {"id": "c", "text": "Both have the same amount", "signals": {"M3": 0.75}},
        ],
        "correct_option_id": "a",
        "rationale": "3/4 = 6/8. Since 6/8 > 5/8, Priya has more ribbon.",
        "context_tag": "transfer_ribbon_sharing",
        "visual": {"type": "number_line", "params": {"points": [{"val": 0.75, "label": "3/4 (Priya)"}, {"val": 0.625, "label": "5/8 (Arjun)"}]}},
        "source_chunk_ids": ["c2"],
        "verified": True,
    },
    # 5. Unit Fractions Probe Question
    {
        "id": "q_unit_fractions_probe",
        "concept_id": "c_unit_fractions",
        "createdFor": "c_unit_fractions",
        "kind": "probe",
        "stem": "If you share a cake equally among 10 people instead of 5 people, what happens to each person's slice?",
        "options": [
            {"id": "a", "text": "Each slice becomes smaller (1/10 < 1/5)", "signals": {}},
            {"id": "b", "text": "Each slice becomes larger because 10 is bigger than 5", "signals": {"M1": 0.9}},
            {"id": "c", "text": "The slice size stays the same", "signals": {}},
        ],
        "correct_option_id": "a",
        "rationale": "More sharing parts means each individual part must be smaller.",
        "context_tag": "unit_fractions_sharing",
        "visual": {"type": "fraction_bar", "params": {"fractions": [{"num": 1, "den": 5, "label": "1/5"}, {"num": 1, "den": 10, "label": "1/10"}]}},
        "source_chunk_ids": ["c1"],
        "verified": True,
    },
    # 6. Parts of Whole Probe Question
    {
        "id": "q_parts_of_whole_probe",
        "concept_id": "c_parts_of_whole",
        "createdFor": "c_parts_of_whole",
        "kind": "probe",
        "stem": "A pizza is cut into 4 slices of completely different, uneven sizes. Does one slice equal 1/4 of the pizza?",
        "options": [
            {"id": "a", "text": "No, because fractions require all parts to be strictly equal in size.", "signals": {}},
            {"id": "b", "text": "Yes, because there are 4 slices so each is 1/4.", "signals": {"M1": 0.9}},
            {"id": "c", "text": "Yes, as long as the slices came from the same pizza.", "signals": {"M1": 0.8}},
        ],
        "correct_option_id": "a",
        "rationale": "Mathematical fractions require equal partitioning.",
        "context_tag": "parts_of_whole_equality",
        "visual": {"type": "none", "params": {}},
        "source_chunk_ids": ["c0"],
        "verified": True,
    },
    # 7. Adding Fractions Probe Question
    {
        "id": "q_adding_fractions_probe",
        "concept_id": "c_adding_fractions",
        "createdFor": "c_adding_fractions",
        "kind": "probe",
        "stem": "What is 1/5 + 2/5?",
        "options": [
            {"id": "a", "text": "3/5", "signals": {}},
            {"id": "b", "text": "3/10", "signals": {"M4": 0.95}},
            {"id": "c", "text": "2/25", "signals": {}},
        ],
        "correct_option_id": "a",
        "rationale": "When adding like fractions, add the numerators and keep the denominator unchanged.",
        "context_tag": "adding_like_fractions",
        "visual": {"type": "fraction_bar", "params": {"fractions": [{"num": 1, "den": 5, "label": "1/5"}, {"num": 2, "den": 5, "label": "2/5"}]}},
        "source_chunk_ids": ["c4"],
        "verified": True,
    },
]

# Pre-generated curated sample explanations for deterministic signature demo
SAMPLE_EXPLANATIONS = {
    "c_comparing_fractions_analogy_visual": {
        "strategy": "analogy_visual",
        "title": "Why a Bigger Denominator Means Smaller Slices",
        "body_markdown": "In 3/8, the 8 means the whole is divided into 8 equal parts, making each individual piece smaller. As noted in your notes: 'In 3/8, the 8 means very small pieces, so 3/8 is less than half, while 2/3 is more than half.'",
        "visual": {"type": "fraction_bar", "params": {"fractions": [{"num": 2, "den": 3, "label": "2/3"}, {"num": 3, "den": 8, "label": "3/8"}]}},
        "source_refs": [{"chunk_id": "c2", "page": 3, "quote": "In 3/8, the 8 means very small pieces, so 3/8 is less than half, while 2/3 is more than half."}],
        "grounded": True,
    },
    "c_comparing_fractions_worked_example": {
        "strategy": "worked_example",
        "title": "Converting to Common Denominators Step by Step",
        "body_markdown": "Instead of looking at the gap between numbers, find equivalent fractions: 2/3 = 16/24 and 3/8 = 9/24. Since 16/24 > 9/24, 2/3 is greater than 3/8. As stated in your notes: 'Never assume that a fraction with bigger numbers is always larger.'",
        "visual": {"type": "fraction_bar", "params": {"fractions": [{"num": 16, "den": 24, "label": "16/24"}, {"num": 9, "den": 24, "label": "9/24"}]}},
        "source_refs": [{"chunk_id": "c2", "page": 3, "quote": "Never assume that a fraction with bigger numbers is always larger. In 3/8, the 8 means very small pieces"}],
        "grounded": True,
    },
    "c_comparing_fractions_simplified": {
        "strategy": "simplified",
        "title": "Use 1/2 as a Benchmark to Compare",
        "body_markdown": "To compare without common denominators, compare each fraction to half (1/2). Half of 3 is 1.5, so 2/3 is more than half. Half of 8 is 4, so 3/8 is less than half. Because 2/3 is greater than half and 3/8 is less than half, 2/3 is larger.",
        "visual": {"type": "fraction_bar", "params": {"fractions": [{"num": 2, "den": 3, "label": "2/3 (> 1/2)"}, {"num": 3, "den": 8, "label": "3/8 (< 1/2)"}]}},
        "source_refs": [{"chunk_id": "c2", "page": 3, "quote": "In 3/8, the 8 means very small pieces, so 3/8 is less than half, while 2/3 is more than half."}],
        "grounded": True,
    },
    "c_comparing_fractions_hint": {
        "strategy": "hint",
        "title": "Think About Which Slices Are Larger",
        "body_markdown": "Hint: If you cut a whole into 3 equal pieces versus 8 equal pieces, which pieces are bigger? Having 2 very large pieces is more than having 3 tiny pieces.",
        "visual": {"type": "fraction_bar", "params": {"fractions": [{"num": 2, "den": 3, "label": "2/3"}, {"num": 3, "den": 8, "label": "3/8"}]}},
        "source_refs": [{"chunk_id": "c2", "page": 3, "quote": "In 3/8, the 8 means very small pieces, so 3/8 is less than half, while 2/3 is more than half."}],
        "grounded": True,
    },
    "c_comparing_fractions_prerequisite_review": {
        "strategy": "prerequisite_review",
        "title": "Reviewing Unit Fractions: 1/3 vs 1/8",
        "body_markdown": "Let's review unit fractions from page 2: as the denominator grows, the size of each part decreases. 1/3 is much bigger than 1/8. Two-thirds (2/3) is made of two large thirds, which is larger than three small eighths (3/8).",
        "visual": {"type": "fraction_bar", "params": {"fractions": [{"num": 1, "den": 3, "label": "1/3"}, {"num": 1, "den": 8, "label": "1/8"}]}},
        "source_refs": [{"chunk_id": "c1", "page": 2, "quote": "Because the same whole is divided into more pieces, each individual piece becomes smaller!"}],
        "grounded": True,
    },
}
