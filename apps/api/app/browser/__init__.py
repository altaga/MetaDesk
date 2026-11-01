"""Headless browser sessions for the desk board.

Playwright's sync API binds greenlets to a single OS thread, so every browser
call is marshalled onto one dedicated worker thread and the async routes only
ever await a queue round-trip.
"""
