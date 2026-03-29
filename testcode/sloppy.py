# Deliberately sloppy Python for testing Deslopify

import os

# PY004: Mutable default argument
def add_items(item, items=[]):
    items.append(item)
    return items

# PY001: No context manager for file handling
def read_config(path):
    f = open(path)
    try:
        data = f.read()
    finally:
        f.close()
    return data

# PY002: No type hints anywhere
def process_users(users, threshold):
    result = []
    for user in users:
        if user["score"] > threshold:
            result.append(user["name"])
    return result

# PY005: os.path instead of pathlib
def get_output_path(base, name):
    return os.path.join(base, "output", name + ".txt")

# PY007: Java-style getters/setters
class User:
    def __init__(self, name, email):
        self._name = name
        self._email = email

    def get_name(self):
        return self._name

    def set_name(self, name):
        self._name = name

    def get_email(self):
        return self._email

    def set_email(self, email):
        self._email = email

# G003: Exception swallowing
def safe_divide(a, b):
    try:
        return a / b
    except:
        pass

# G006: Hardcoded secrets
API_KEY = "sk-proj-abc123def456"
DB_PASSWORD = "password123"
