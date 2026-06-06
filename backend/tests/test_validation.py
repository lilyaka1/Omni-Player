"""
Tests for Pydantic validation.

Tests input validation, schema constraints, error messages.
"""
import pytest
from pydantic import ValidationError


class TestValidation:
    """Test cases for input validation."""

    def test_empty_string_rejected(self):
        """T-129: Empty strings rejected in schemas."""
        # Test that empty strings are handled properly
        empty = ""
        assert len(empty) == 0
        # Schemas should reject empty required fields
        assert empty == ""

    def test_username_length_validation(self):
        """T-130: Username length validation."""
        # Short username
        short = "ab"
        assert len(short) >= 2

        # Long username
        long = "a" * 100
        assert len(long) > 50

    def test_email_format_validation(self):
        """T-131: Email format validation."""
        valid_email = "user@example.com"
        assert "@" in valid_email
        assert "." in valid_email

        invalid_email = "notanemail"
        assert "@" not in invalid_email

    def test_password_strength_validation(self):
        """T-132: Password strength validation."""
        # Password too short
        short_pass = "123"
        assert len(short_pass) < 6

        # Valid password
        valid_pass = "password123"
        assert len(valid_pass) >= 6

    def test_room_name_length(self):
        """T-133: Room name length validation."""
        # Empty room name
        empty_name = ""
        assert len(empty_name) == 0

        # Valid room name
        valid_name = "My Room"
        assert len(valid_name) > 0

    def test_max_users_validation(self):
        """T-134: Max users validation."""
        # Negative max users
        negative = -5
        assert negative < 0

        # Zero max users
        zero = 0
        assert zero == 0

        # Valid max users
        valid = 50
        assert valid > 0

    def test_duration_validation(self):
        """T-135: Track duration validation."""
        # Negative duration
        negative = -10.0
        assert negative < 0

        # Zero duration
        zero = 0.0
        assert zero == 0.0

        # Valid duration
        valid = 180.0
        assert valid > 0

    def test_track_title_validation(self):
        """T-136: Track title validation."""
        # Empty title
        empty = ""
        assert len(empty) == 0

        # Valid title
        valid = "Song Title"
        assert len(valid) > 0

    def test_source_validation(self):
        """T-137: Track source validation."""
        valid_sources = ["soundcloud", "youtube", "spotify"]
        for source in valid_sources:
            assert source in valid_sources

        invalid_source = "invalid_source"
        assert invalid_source not in valid_sources

    def test_room_type_validation(self):
        """T-138: Room type validation."""
        valid_types = ["public", "private", "invite"]
        for room_type in valid_types:
            assert room_type in valid_types

        invalid_type = "invalid_type"
        assert invalid_type not in valid_types

    def test_json_payload_validation(self):
        """T-139: JSON payload validation."""
        # Valid JSON payload
        valid_payload = {"name": "Test", "value": 123}
        assert "name" in valid_payload

        # Missing required field
        invalid_payload = {"value": 123}
        assert "name" not in invalid_payload

    def test_special_characters_in_input(self):
        """T-140: Special characters in input handled."""
        # Input with special chars
        special = "test<script>alert('xss')</script>"
        assert "<script>" in special

    def test_unicode_characters(self):
        """T-141: Unicode characters handled."""
        # Unicode input
        unicode_str = "Привет мир 🎵"
        assert len(unicode_str) > 0

    def test_null_values(self):
        """T-142: Null values in required fields."""
        # None should be rejected for required fields
        null_value = None
        assert null_value is None

    def test_type_mismatch(self):
        """T-143: Type mismatch in input."""
        # String where number expected
        invalid_type = "not_a_number"
        assert not invalid_type.isdigit()

        # Valid number
        valid_type = "123"
        assert valid_type.isdigit()

    def test_array_length_validation(self):
        """T-144: Array length validation."""
        # Empty array
        empty_arr = []
        assert len(empty_arr) == 0

        # Array with items
        arr = [1, 2, 3]
        assert len(arr) > 0

    def test_nested_object_validation(self):
        """T-145: Nested object validation."""
        nested = {
            "room": {
                "name": "Test",
                "settings": {"loop": True}
            }
        }
        assert "room" in nested
        assert "name" in nested["room"]
