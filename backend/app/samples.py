"""Sample pages for tests and demo."""

from __future__ import annotations

from .ingestion.extract import Page


def fractions_pages() -> list[Page]:
    p1 = (
        "Equal parts of a whole. A fraction represents a part of a whole. "
        "The bottom number is the denominator, telling how many equal parts. "
        "The top number is the numerator, telling how many parts we take. "
        "Crucially, all parts must be strictly equal."
    )
    p2 = (
        "Unit fractions and part size. A unit fraction has a numerator of 1. "
        "As the denominator grows larger, each individual piece becomes smaller. "
        "1/8 is smaller than 1/4 because 1 cake cut into 8 pieces means smaller pieces."
    )
    p3 = (
        "Comparing fractions. Compare numerators when denominators match. "
        "When numerators match, the smaller denominator is the larger fraction. "
        "Never assume that bigger numbers make a fraction bigger."
    )
    p4 = (
        "Equivalent fractions. Fractions that name the same amount of a whole. "
        "1/2, 2/4, 3/6, and 4/8 represent the same quantity. Multiply or divide "
        "both numerator and denominator by the same number."
    )
    return [Page(1, p1), Page(2, p2), Page(3, p3), Page(4, p4)]
