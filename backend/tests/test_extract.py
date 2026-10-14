import pymupdf
import pytest

from app.errors import AppError
from app.ingestion import extract as E

LONG = "Fractions describe equal parts of a whole. A fraction has a numerator and a denominator. "


def make_pdf(page_texts, password=None):
    doc = pymupdf.open()
    for t in page_texts:
        page = doc.new_page()
        if t:
            page.insert_textbox(pymupdf.Rect(40, 40, 550, 800), t, fontsize=11)
    if password:
        data = doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw=password, user_pw=password)
    else:
        data = doc.tobytes()
    doc.close()
    return data


def make_image(fmt):
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 20, 20), False)
    pix.clear_with(200)
    return pix.tobytes(fmt)


def code(exc):
    return exc.value.code


def test_text_pdf_keeps_page_numbers():
    out = E.extract_upload(make_pdf([LONG * 2, LONG * 3]))
    assert out.kind == "pdf"
    assert [p.number for p in out.pages] == [1, 2]
    assert all(not p.needs_vision for p in out.pages)
    assert "numerator" in out.pages[0].text


def test_blank_page_needs_vision():
    out = E.extract_upload(make_pdf([LONG * 2, ""]))
    assert out.pages[1].needs_vision and not out.pages[0].needs_vision


def test_encrypted_pdf():
    with pytest.raises(AppError) as e:
        E.extract_upload(make_pdf([LONG], password="secret"))
    assert code(e) == "pdf_encrypted"


def test_too_many_pages():
    with pytest.raises(AppError) as e:
        E.extract_upload(make_pdf([LONG] * (E.MAX_PAGES + 1)))
    assert code(e) == "too_many_pages"


def test_bad_magic_bytes():
    with pytest.raises(AppError) as e:
        E.extract_upload(b"MZ\x90\x00 not a document")
    assert code(e) == "unsupported_file" and e.value.status == 415


def test_corrupt_pdf():
    with pytest.raises(AppError) as e:
        E.extract_upload(b"%PDF-1.7\nthis is garbage")
    assert code(e) == "unreadable_file"


def test_empty_and_oversize():
    with pytest.raises(AppError) as e:
        E.extract_upload(b"")
    assert code(e) == "unreadable_file"
    with pytest.raises(AppError) as e:
        E.extract_upload(b"%PDF-" + b"0" * E.MAX_BYTES)
    assert code(e) == "file_too_large" and e.value.status == 413


@pytest.mark.parametrize("fmt,mime", [("png", "image/png"), ("jpeg", "image/jpeg")])
def test_images_go_to_vision(fmt, mime):
    out = E.extract_upload(make_image(fmt))
    assert out.kind == "image" and out.mime == mime
    assert out.pages[0].needs_vision


def test_paste_limits_and_cleaning():
    out = E.extract_pasted("  " + LONG + "\x00\x07 more   words here.\r\n\r\n\r\n\r\nEnd. ")
    assert out.kind == "text"
    t = out.pages[0].text
    assert "\x00" not in t and "\r" not in t and "\n\n\n" not in t and "  " not in t
    with pytest.raises(AppError) as e:
        E.extract_pasted("too short")
    assert code(e) == "text_too_short"
    with pytest.raises(AppError) as e:
        E.extract_pasted("word " * (E.MAX_PASTE_CHARS // 4))
    assert code(e) == "text_too_long"
