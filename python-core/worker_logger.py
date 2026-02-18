"""
File-based logging for MAGIC QC measurement workers.
Redirects all stdout/stderr to rotating log files so that no console
window output is visible to the operator.

Usage (MUST be the first lines in any worker script):
    from worker_logger import setup_file_logging
    setup_file_logging('measurement')   # or 'calibration', 'registration', etc.

After calling setup_file_logging(), every print() and sys.stderr.write()
will be routed to  logs/<name>.log  with timestamps.
"""
import sys
import os
import logging
from logging.handlers import RotatingFileHandler

# ---------------------------------------------------------------------------
# Log directory lives at the PROJECT ROOT (parent of python-core/)
# Frozen (PyInstaller): sys.executable is the .exe sitting in PROJECT_ROOT
# Dev:                   this file is at PROJECT_ROOT/python-core/worker_logger.py
# ---------------------------------------------------------------------------
if getattr(sys, 'frozen', False):
    PROJECT_ROOT = os.path.dirname(sys.executable)
else:
    _CORE_DIR = os.path.dirname(os.path.abspath(__file__))
    PROJECT_ROOT = os.path.dirname(_CORE_DIR)
LOG_DIR = os.path.join(PROJECT_ROOT, 'logs')
os.makedirs(LOG_DIR, exist_ok=True)


class _LoggerWriter:
    """File-like object that forwards write() calls to a logging.Logger."""

    def __init__(self, logger: logging.Logger, level: int):
        self._logger = logger
        self._level = level

    # -- file-like interface used by print() / tracebacks --

    def write(self, message: str) -> None:
        if message and message.strip():
            for line in message.rstrip().splitlines():
                self._logger.log(self._level, line)

    def flush(self) -> None:           # noqa: required by file protocol
        for handler in self._logger.handlers:
            handler.flush()

    def isatty(self) -> bool:
        return False

    @property
    def encoding(self) -> str:
        return 'utf-8'


def setup_file_logging(name: str = 'worker', max_bytes: int = 5 * 1024 * 1024,
                        backup_count: int = 3) -> logging.Logger:
    """
    Configure rotating-file logging and redirect *sys.stdout* / *sys.stderr*
    to the log file.  Returns the logger instance for direct use if desired.

    Parameters
    ----------
    name : str
        Base name for the log file (e.g. 'measurement' -> logs/measurement.log).
    max_bytes : int
        Maximum size of each log file before rotation (default 5 MB).
    backup_count : int
        Number of rotated backup files to keep (default 3).
    """
    log_path = os.path.join(LOG_DIR, f'{name}.log')

    handler = RotatingFileHandler(
        log_path,
        maxBytes=max_bytes,
        backupCount=backup_count,
        encoding='utf-8',
    )
    handler.setFormatter(logging.Formatter(
        '%(asctime)s [%(levelname)s] %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S',
    ))

    logger = logging.getLogger(f'magicqc.{name}')
    logger.setLevel(logging.DEBUG)
    # Avoid duplicate handlers on re-import
    if not logger.handlers:
        logger.addHandler(handler)

    # Redirect Python-level stdout / stderr to the file logger.
    sys.stdout = _LoggerWriter(logger, logging.INFO)
    sys.stderr = _LoggerWriter(logger, logging.ERROR)

    logger.info('='*60)
    logger.info(f'Logger initialised  -  {name}  ->  {log_path}')
    logger.info('='*60)

    return logger
