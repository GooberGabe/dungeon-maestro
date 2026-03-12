"""DungeonMaestro sidecar package."""

from importlib import import_module

__all__ = ["__version__", "load_optional_module"]

__version__ = "0.1.0"


def load_optional_module(module_name: str):
    """Import an optional dependency at runtime and return the module.

    Raises ImportError with context if the module is not installed.
    """
    return import_module(module_name)
