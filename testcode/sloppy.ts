// Deliberately sloppy TypeScript code for testing Deslopify
// Every function here violates multiple Deslopify rules

import _ from "lodash";
import moment from "moment";

// G001: Narrow solution — only works with strings
function removeDuplicates(arr: string[]): string[] {
  let result: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (result.indexOf(arr[i]) === -1) {
      result.push(arr[i]);
    }
  }
  return result;
}

// TS001: any leakage everywhere
function processData(data: any) {
  const result = data.items.map((item: any) => {
    return item.value as number;
  });
  return result;
}

// G003: Exception swallowing
async function fetchUser(id: number) {
  try {
    const response = await fetch(`http://localhost:3000/users/${id}`);
    const data = await response.json();
    return data;
  } catch (e) {
    console.log(e);
    return null;
  }
}

// G006: Hardcoded configuration
function getApiUrl() {
  return "http://localhost:3000/api/v1";
}

const API_SECRET = "sk_live_abc123_super_secret_key";
const MAX_RETRIES = 3;

// G008: Untestable — creates its own dependencies
class UserService {
  private db = new Database();
  private cache = new RedisCache();

  async getUser(id: number) {
    const cached = this.cache.get(`user:${id}`);
    if (cached) return cached;
    const user = this.db.query(`SELECT * FROM users WHERE id = ${id}`);
    return user;
  }
}

// G005: Copy-paste duplication
function processAdminOrder(order: any) {
  const validated = validateOrder(order);
  const saved = saveOrder(validated);
  sendNotification(saved, "admin");
  return saved;
}

function processUserOrder(order: any) {
  const validated = validateOrder(order);
  const saved = saveOrder(validated);
  sendNotification(saved, "user");
  return saved;
}

// G007: No error handling at all
function divideNumbers(a: number, b: number) {
  return a / b;
}

function parseConfig(json: string) {
  return JSON.parse(json);
}

// G009: Over-engineered for no reason
interface IUserFactoryProvider {
  createFactory(): IUserFactory;
}

interface IUserFactory {
  createUser(name: string): User;
}

class DefaultUserFactoryProvider implements IUserFactoryProvider {
  createFactory(): IUserFactory {
    return new DefaultUserFactory();
  }
}
