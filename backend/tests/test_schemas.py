from app.schemas import Option, Question


def make_question():
    return Question(
        id="q1",
        concept_id="c1",
        kind="probe",
        stem="Which is larger: 1/3 or 1/5?",
        options=[
            Option(id="a", text="1/3"),
            Option(id="b", text="1/5", signals={"M1": 0.8}),
            Option(id="c", text="They are equal", signals={"M2": 0.6}),
        ],
        correct_option_id="a",
        rationale="Same numerator; fewer pieces means bigger pieces.",
        context_tag="pizza",
    )


def test_public_question_never_leaks_key_or_signals():
    public = make_question().to_public().model_dump()
    text = str(public)
    assert "correct_option_id" not in text
    assert "signals" not in text
    assert "rationale" not in text
    assert public["options"] == [
        {"id": "a", "text": "1/3"},
        {"id": "b", "text": "1/5"},
        {"id": "c", "text": "They are equal"},
    ]
