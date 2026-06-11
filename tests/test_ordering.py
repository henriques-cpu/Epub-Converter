from mangaconv.core.ordering import is_spread, order_pages


def test_natural_sort_without_padding():
    names = ["page2.jpg", "page10.jpg", "page1.jpg"]
    assert order_pages(names) == ["page1.jpg", "page2.jpg", "page10.jpg"]


def test_chapter_prefixes_sort_correctly():
    names = ["ch2/p1.jpg", "ch10/p1.jpg", "ch1/p2.jpg", "ch1/p1.jpg"]
    assert order_pages(names) == [
        "ch1/p1.jpg",
        "ch1/p2.jpg",
        "ch2/p1.jpg",
        "ch10/p1.jpg",
    ]


def test_letter_suffixes():
    names = ["000b.jpg", "000a.jpg", "001.jpg"]
    assert order_pages(names) == ["000a.jpg", "000b.jpg", "001.jpg"]


def test_cover_floats_to_front_and_extras_sink():
    names = ["page1.jpg", "extras.jpg", "cover.jpg", "page2.jpg"]
    assert order_pages(names) == ["cover.jpg", "page1.jpg", "page2.jpg", "extras.jpg"]


def test_matter_separation_can_be_disabled():
    names = ["page1.jpg", "cover.jpg"]
    # Without separation, natural sort puts cover after page1 alphabetically.
    assert order_pages(names, separate_matter=False) == ["cover.jpg", "page1.jpg"]


def test_spread_detection():
    assert is_spread("004-005.jpg")
    assert is_spread("004_005.jpg")
    assert not is_spread("004-009.jpg")
    assert not is_spread("page004.jpg")
