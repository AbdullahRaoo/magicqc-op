"""
Build script — compile core_main.py into a single Windows executable.

Usage:
    cd python-core
    python build_exe.py

Output:
    python-core/dist/magicqc_core.exe
"""
import PyInstaller.__main__
import os
import shutil
import time
import logging
import sys

# psutil is optional - if not available, process detection will be skipped
try:
    import psutil
    PSUTIL_AVAILABLE = True
except ImportError:
    PSUTIL_AVAILABLE = False
    print('⚠️  Warning: psutil not available. Process detection will be skipped.')

SCRIPT = 'core_main.py'
EXE_NAME = 'magicqc_core'

# All local modules that PyInstaller can't auto-discover (lazy/conditional imports)
HIDDEN_IMPORTS = [
    # Local modules
    'worker_logger',
    'measurement_worker',
    'calibration_worker',
    'integration',
    'mvsdk',
    # Flask stack
    'flask',
    'flask_cors',
    'flask.json',
    'flask.sansio',
    'flask.sansio.app',
    'flask.sansio.blueprints',
    'flask.sansio.scaffold',
    'jinja2',
    'markupsafe',
    'werkzeug',
    'werkzeug.serving',
    'werkzeug.debug',
    'click',
    'blinker',
    'itsdangerous',
    # Scientific stack
    'cv2',
    'numpy',
    'scipy',
    'scipy.ndimage',
    'PIL',
    'PIL.Image',
    # Utilities
    'psutil',
    'dotenv',
    'base64',
    'ctypes',
    'logging',
    'logging.handlers',
    'argparse',
    'json',
    'threading',
    'platform',
    'signal',
    'math',
    'io',
    'datetime',
]

# Packages we don't need — excludes heavy Conda ML stack to keep exe lean
EXCLUDES = [
    'tkinter',
    'matplotlib',
    'pandas',
    'test',
    'unittest',
    'xmlrpc',
    'pydoc',
    'doctest',
    # Heavy ML packages from Conda base env (NOT used by MagicQC)
    'torch',
    'torchvision',
    'torchaudio',
    'tensorflow',
    'tensorboard',
    'keras',
    'sklearn',
    'scikit-learn',
    'transformers',
    'huggingface_hub',
    'tokenizers',
    'safetensors',
    'accelerate',
    'datasets',
    'numexpr',
    'numba',
    'llvmlite',
    'sympy',
    'IPython',
    'jupyter',
    'notebook',
    'sphinx',
    'grpc',
    'grpcio',
    'google',
    'google.protobuf',
    'tensorstore',
    'jax',
    'jaxlib',
    'pydantic',
]

def find_magicqc_processes():
    """Find all running processes related to MagicQC Python core."""
    if not PSUTIL_AVAILABLE:
        return []
    
    processes = []
    current_pid = os.getpid()
    
    for proc in psutil.process_iter(['pid', 'name', 'exe', 'cmdline']):
        try:
            pid = proc.info['pid']
            if pid == current_pid:
                continue
            
            name = (proc.info['name'] or '').lower()
            exe = (proc.info['exe'] or '').lower()
            cmdline = proc.info['cmdline'] or []
            cmdline_str = ' '.join(cmdline).lower()
            
            # Check for magicqc_core.exe (case-insensitive)
            if 'magicqc_core.exe' in name or 'magicqc_core.exe' in exe:
                processes.append(proc)
            # Check for Python processes running core_main.py or measurement_worker
            elif 'python' in name or 'pythonw' in name:
                if any(x in cmdline_str for x in ['core_main.py', 'measurement_worker.py', 'calibration_worker.py', 'api_server']):
                    processes.append(proc)
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
    
    return processes


def terminate_magicqc_processes():
    """Gracefully terminate MagicQC Python core processes."""
    processes = find_magicqc_processes()
    if not processes:
        return 0
    
    print(f'\n🔍 Found {len(processes)} running MagicQC process(es), terminating...')
    terminated_pids = []
    
    for proc in processes:
        try:
            pid = proc.info['pid']
            name = proc.info['name'] or 'unknown'
            print(f'   Terminating PID {pid} ({name})...')
            proc.terminate()
            terminated_pids.append(pid)
        except (psutil.NoSuchProcess, psutil.AccessDenied) as e:
            print(f'   ⚠️  Could not terminate PID {proc.info.get("pid", "?")}: {e}')
    
    # Wait for graceful shutdown (max 5 seconds)
    if terminated_pids:
        print('   Waiting for graceful shutdown...')
        for _ in range(10):
            still_running = []
            for pid in terminated_pids:
                try:
                    if psutil.pid_exists(pid):
                        still_running.append(pid)
                except Exception:
                    pass
            if not still_running:
                break
            time.sleep(0.5)
        
        # Force kill any remaining
        for pid in still_running:
            try:
                proc = psutil.Process(pid)
                print(f'   Force killing PID {pid}...')
                proc.kill()
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
    
    return len(terminated_pids)


def safe_remove_path(path, max_retries=5, base_delay=0.5):
    """
    Safely remove a file or directory with retry and exponential backoff.
    Handles locked log files by closing logging handlers first.
    """
    if not os.path.exists(path):
        return True
    
    is_dir = os.path.isdir(path)
    
    # If it's a logs directory or contains log files, try to close logging handlers
    if is_dir and 'logs' in path.lower():
        try:
            logging.shutdown()
            # Close all handlers in all loggers
            for logger_name in list(logging.Logger.manager.loggerDict.keys()):
                logger = logging.getLogger(logger_name)
                for handler in logger.handlers[:]:
                    try:
                        handler.close()
                        logger.removeHandler(handler)
                    except Exception:
                        pass
        except Exception:
            pass
    
    for attempt in range(max_retries):
        try:
            if is_dir:
                # For directories, try to remove files first, then the directory
                # This helps with partially locked directories
                try:
                    shutil.rmtree(path)
                except PermissionError:
                    # If rmtree fails, try removing files individually
                    if attempt < max_retries - 1:
                        for root, dirs, files in os.walk(path, topdown=False):
                            for file in files:
                                try:
                                    os.remove(os.path.join(root, file))
                                except PermissionError:
                                    pass
                            for dir_name in dirs:
                                try:
                                    os.rmdir(os.path.join(root, dir_name))
                                except (PermissionError, OSError):
                                    pass
                        # Try removing the directory itself
                        try:
                            os.rmdir(path)
                        except PermissionError:
                            raise
                    else:
                        raise
            else:
                os.remove(path)
            return True
        except PermissionError as e:
            if attempt < max_retries - 1:
                delay = base_delay * (2 ** attempt)  # Exponential backoff: 0.5s, 1s, 2s, 4s
                print(f'   ⚠️  Locked: {os.path.basename(path)} (attempt {attempt + 1}/{max_retries}), retrying in {delay:.1f}s...')
                time.sleep(delay)
            else:
                print(f'   ❌ Failed to remove {path} after {max_retries} attempts: {e}')
                return False
        except Exception as e:
            print(f'   ❌ Error removing {path}: {e}')
            return False
    
    return False


def safe_cleanup_build_dirs(here):
    """Safely clean build directories, handling locked log files."""
    print('\n🧹 Cleaning previous build artifacts...')
    
    # First, try to terminate any running MagicQC processes
    terminated = terminate_magicqc_processes()
    if terminated > 0:
        time.sleep(1)  # Give OS time to release file handles
    
    # Close any logging handlers that might be holding file locks
    try:
        logging.shutdown()
        # Close all handlers in root logger and all sub-loggers
        for logger_name in logging.Logger.manager.loggerDict:
            logger = logging.getLogger(logger_name)
            for handler in logger.handlers[:]:
                handler.close()
                logger.removeHandler(handler)
    except Exception as e:
        print(f'   ⚠️  Warning: Could not close all logging handlers: {e}')
    
    # Clean up directories and files
    targets = [
        ('build', True),
        ('dist', True),
        (f'{EXE_NAME}.spec', False),
    ]
    
    # Special handling: delete logs subdirectory and individual log files separately before deleting dist
    dist_path = os.path.join(here, 'dist')
    logs_in_dist = os.path.join(dist_path, 'logs')
    if os.path.exists(logs_in_dist):
        print('   Removing logs/ subdirectory first...')
        # Try to remove individual log files first
        try:
            for log_file in ['api_server.log', 'measurement.log', 'calibration.log']:
                log_path = os.path.join(logs_in_dist, log_file)
                if os.path.exists(log_path):
                    safe_remove_path(log_path, max_retries=3, base_delay=0.3)
        except Exception as e:
            print(f'   ⚠️  Warning: Could not remove individual log files: {e}')
        # Then remove the directory
        safe_remove_path(logs_in_dist, max_retries=5, base_delay=0.5)
    
    all_success = True
    for name, is_dir in targets:
        target = os.path.join(here, name)
        if os.path.exists(target):
            print(f'   Removing {name}...')
            if not safe_remove_path(target, max_retries=5, base_delay=0.5):
                all_success = False
                if is_dir:
                    print(f'   ⚠️  Warning: Could not fully remove {name}/, some files may be locked.')
                    print(f'      You may need to manually close any running MagicQC processes.')
    
    return all_success


def ensure_runtime_dirs(here):
    """Ensure required runtime directories exist after build."""
    project_root = os.path.dirname(here)  # Parent of python-core/
    runtime_dirs = [
        os.path.join(project_root, 'storage'),
        os.path.join(project_root, 'storage', 'measurement_results'),
        os.path.join(project_root, 'logs'),
    ]
    
    print('\n📁 Ensuring runtime directories exist...')
    for dir_path in runtime_dirs:
        try:
            os.makedirs(dir_path, exist_ok=True)
            print(f'   ✓ {os.path.relpath(dir_path, project_root)}')
        except Exception as e:
            print(f'   ⚠️  Warning: Could not create {dir_path}: {e}')


def build():
    here = os.path.dirname(os.path.abspath(__file__))
    os.chdir(here)

    print(f'\n{"="*60}')
    print(f'  Building {EXE_NAME}.exe from {SCRIPT}')
    print(f'{"="*60}')

    # Stage 1: Clean previous build artifacts (with locked file handling)
    print('\n[Stage 1/4] Clean → Removing previous build artifacts...')
    cleanup_success = safe_cleanup_build_dirs(here)
    if not cleanup_success:
        print('\n⚠️  Warning: Some files could not be removed. Build will continue, but you may need to manually close running processes.')
    
    # Stage 1.5: Validate Cython Binaries
    print('\n[Stage 1.5/4] Validate → Checking for Cython binaries...')
    cython_modules = ['integration', 'measurement_worker', 'worker_logger']
    missing_binaries = []
    for mod in cython_modules:
        found = False
        for file in os.listdir(here):
            if file.startswith(mod) and file.endswith('.pyd'):
                found = True
                print(f'   ✓ Found compiled binary: {file}')
                break
        if not found:
            missing_binaries.append(mod)
    
    if missing_binaries:
        print(f'\n⚠️  Warning: Missing Cython binaries for: {", ".join(missing_binaries)}')
        print('   Source .py files will be used instead. Run "python setup_cython.py build_ext --inplace" first for maximum protection.')
    
    # Stage 2: Compile → Run PyInstaller
    print('\n[Stage 2/4] Compile → Running PyInstaller...')

    args = [
        SCRIPT,
        '--onefile',
        '--noconsole',
        f'--name={EXE_NAME}',
        f'--distpath={os.path.join(here, "dist")}',
        f'--workpath={os.path.join(here, "build")}',
        f'--specpath={here}',
        # Ensure python-core/ directory is on the module search path so that
        # .pyd Cython binaries in this directory are discovered automatically.
        f'--paths={here}',
    ]

    for mod in HIDDEN_IMPORTS:
        args.extend(['--hidden-import', mod])

    for pkg in EXCLUDES:
        args.extend(['--exclude-module', pkg])

    # Explicitly bundle every .pyd Cython binary found alongside this script.
    # --hidden-import tells PyInstaller a module exists, but does NOT guarantee
    # the native .pyd file is embedded.  --add-binary guarantees embedding.
    pyd_files_found = []
    for fname in os.listdir(here):
        if fname.endswith('.pyd'):
            pyd_src = os.path.join(here, fname)
            # Destination '.' means PyInstaller places it at the root of the
            # bundled layout where Python can import it when the EXE extracts.
            args.extend(['--add-binary', f'{pyd_src}{os.pathsep}.'])
            pyd_files_found.append(fname)

    if pyd_files_found:
        print(f'  Bundling Cython .pyd binaries ({len(pyd_files_found)}):')
        for pf in pyd_files_found:
            print(f'    + {pf}')
    else:
        print('  ⚠️  No .pyd Cython binaries found — pure-Python fallbacks will be used.')
        print('     Run "python setup_cython.py build_ext --inplace" first for IP protection.')

    print(f'  Hidden imports: {len(HIDDEN_IMPORTS)}')
    print(f'  Excludes:       {len(EXCLUDES)}')
    
    try:
        PyInstaller.__main__.run(args)
    except Exception as e:
        print(f'\n❌ PyInstaller failed: {e}')
        raise SystemExit(1)

    # Stage 3: Bundle → Verify exe exists
    print('\n[Stage 3/4] Bundle → Verifying executable...')
    exe_path = os.path.join(here, 'dist', f'{EXE_NAME}.exe')
    if os.path.isfile(exe_path):
        size_mb = os.path.getsize(exe_path) / (1024 * 1024)
        print(f'   ✓ Executable created: {os.path.basename(exe_path)}')
        print(f'   ✓ Size: {size_mb:.1f} MB')
    else:
        print(f'\n❌ Build failed — {exe_path} not found')
        raise SystemExit(1)
    
    # Stage 4: Validate → Ensure runtime directories exist
    print('\n[Stage 4/4] Validate → Setting up runtime directories...')
    ensure_runtime_dirs(here)
    
    print(f'\n{"="*60}')
    print(f'✅ Build successful: {exe_path}')
    print(f'{"="*60}\n')


if __name__ == '__main__':
    build()
