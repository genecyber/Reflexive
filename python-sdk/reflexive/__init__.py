"""
Reflexive - AI-powered introspection for Python applications

This module provides the library mode API for embedding Reflexive
into your Python application.
"""

from .core import make_reflexive, ReflexiveInstance, AppState
from .types import LogEntry, LogType, AppStatus

__version__ = "0.1.0"
__all__ = [
    "make_reflexive",
    "ReflexiveInstance",
    "AppState",
    "LogEntry",
    "LogType",
    "AppStatus",
]
