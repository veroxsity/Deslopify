// Deliberately sloppy C++ code for testing Deslopify

#include <iostream>
#include <vector>
#include <string>
#include <mutex>

// CPP001: Raw new/delete instead of smart pointers
class ResourceManager {
    Widget* widget;
    Connection* conn;
public:
    ResourceManager() {
        widget = new Widget();
        conn = new Connection("localhost", 5432);
    }
    ~ResourceManager() {
        delete widget;
        delete conn;
    }
};

// CPP002: Manual lock/unlock instead of RAII
std::mutex mtx;
int sharedCounter = 0;

void incrementCounter() {
    mtx.lock();
    sharedCounter++;
    doSomethingRisky(); // if this throws, mutex is never unlocked
    mtx.unlock();
}

// CPP004: Manual loop instead of algorithm
int findMax(std::vector<int> nums) { // also: should be const ref
    int max = nums[0]; // no empty check
    for (int i = 1; i < nums.size(); i++) {
        if (nums[i] > max) {
            max = nums[i];
        }
    }
    return max;
}

// G006: Hardcoded config
std::string getDbUrl() {
    return "postgresql://admin:password123@localhost:5432/mydb";
}

// G003: Exception swallowing
void processFile(const std::string& path) {
    try {
        auto data = readFile(path);
        parse(data);
    } catch (...) {
        // silently ignore all errors
    }
}
