try:
    from setuptools import setup
    from Cython.Build import cythonize
    import os
    import shutil

    # Modules to compile
    modules = [
        "integration.py",
        "measurement_worker.py",
        "worker_logger.py"
    ]

    print(f"--- Cythonizing {len(modules)} modules ---")

    setup(
        ext_modules=cythonize(modules, compiler_directives={'language_level': "3"}),
    )

    # Cleanup .c files
    for m in modules:
        c_file = m.replace(".py", ".c")
        if os.path.exists(c_file):
            print(f"Removing temporary C file: {c_file}")
            os.remove(c_file)

    print("--- Cythonization Successful ---")

except Exception as e:
    print(f"--- Cythonization Failed: {e} ---")
    import traceback
    traceback.print_exc()
