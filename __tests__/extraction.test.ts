/**
 * Extraction Tests
 *
 * Tests for the tree-sitter extraction system.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CodeGraph } from '../src';
import { extractFromSource } from '../src/extraction';
import { detectLanguage, isLanguageSupported, getSupportedLanguages } from '../src/extraction/grammars';

// Create a temporary directory for each test
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-test-'));
}

// Clean up temporary directory
function cleanupTempDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('Language Detection', () => {
  it('should detect TypeScript files', () => {
    expect(detectLanguage('src/index.ts')).toBe('typescript');
    expect(detectLanguage('components/Button.tsx')).toBe('tsx');
  });

  it('should detect JavaScript files', () => {
    expect(detectLanguage('index.js')).toBe('javascript');
    expect(detectLanguage('App.jsx')).toBe('jsx');
    expect(detectLanguage('config.mjs')).toBe('javascript');
  });

  it('should detect Python files', () => {
    expect(detectLanguage('main.py')).toBe('python');
  });

  it('should detect Go files', () => {
    expect(detectLanguage('main.go')).toBe('go');
  });

  it('should detect Rust files', () => {
    expect(detectLanguage('lib.rs')).toBe('rust');
  });

  it('should detect Java files', () => {
    expect(detectLanguage('Main.java')).toBe('java');
  });

  it('should detect C files', () => {
    expect(detectLanguage('main.c')).toBe('c');
    expect(detectLanguage('utils.h')).toBe('c');
  });

  it('should detect C++ files', () => {
    expect(detectLanguage('main.cpp')).toBe('cpp');
    expect(detectLanguage('class.hpp')).toBe('cpp');
  });

  it('should detect C# files', () => {
    expect(detectLanguage('Program.cs')).toBe('csharp');
  });

  it('should detect PHP files', () => {
    expect(detectLanguage('index.php')).toBe('php');
  });

  it('should detect Ruby files', () => {
    expect(detectLanguage('app.rb')).toBe('ruby');
  });

  it('should detect Swift files', () => {
    expect(detectLanguage('ViewController.swift')).toBe('swift');
  });

  it('should detect Kotlin files', () => {
    expect(detectLanguage('MainActivity.kt')).toBe('kotlin');
    expect(detectLanguage('build.gradle.kts')).toBe('kotlin');
  });

  it('should return unknown for unsupported extensions', () => {
    expect(detectLanguage('styles.css')).toBe('unknown');
    expect(detectLanguage('data.json')).toBe('unknown');
  });
});

describe('Language Support', () => {
  it('should report supported languages', () => {
    expect(isLanguageSupported('typescript')).toBe(true);
    expect(isLanguageSupported('python')).toBe(true);
    expect(isLanguageSupported('go')).toBe(true);
    expect(isLanguageSupported('unknown')).toBe(false);
  });

  it('should list all supported languages', () => {
    const languages = getSupportedLanguages();
    expect(languages).toContain('typescript');
    expect(languages).toContain('javascript');
    expect(languages).toContain('python');
    expect(languages).toContain('go');
    expect(languages).toContain('rust');
    expect(languages).toContain('java');
    expect(languages).toContain('csharp');
    expect(languages).toContain('php');
    expect(languages).toContain('ruby');
    expect(languages).toContain('swift');
    expect(languages).toContain('kotlin');
  });
});

describe('TypeScript Extraction', () => {
  it('should extract function declarations', () => {
    const code = `
export function processPayment(amount: number): Promise<Receipt> {
  return stripe.charge(amount);
}
`;
    const result = extractFromSource('payment.ts', code);

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      kind: 'function',
      name: 'processPayment',
      language: 'typescript',
      isExported: true,
    });
    expect(result.nodes[0]?.signature).toContain('amount: number');
  });

  it('should extract class declarations', () => {
    const code = `
export class PaymentService {
  private stripe: StripeClient;

  constructor(apiKey: string) {
    this.stripe = new StripeClient(apiKey);
  }

  async charge(amount: number): Promise<Receipt> {
    return this.stripe.charge(amount);
  }
}
`;
    const result = extractFromSource('service.ts', code);

    const classNode = result.nodes.find((n) => n.kind === 'class');
    const methodNodes = result.nodes.filter((n) => n.kind === 'method');

    expect(classNode).toBeDefined();
    expect(classNode?.name).toBe('PaymentService');
    expect(classNode?.isExported).toBe(true);

    expect(methodNodes.length).toBeGreaterThanOrEqual(1);
    const chargeMethod = methodNodes.find((m) => m.name === 'charge');
    expect(chargeMethod).toBeDefined();
  });

  it('should extract interfaces', () => {
    const code = `
export interface User {
  id: string;
  name: string;
  email: string;
}
`;
    const result = extractFromSource('types.ts', code);

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      kind: 'interface',
      name: 'User',
      isExported: true,
    });
  });

  it('should track function calls', () => {
    const code = `
function main() {
  const result = processData();
  console.log(result);
}
`;
    const result = extractFromSource('main.ts', code);

    expect(result.unresolvedReferences.length).toBeGreaterThan(0);
    const calls = result.unresolvedReferences.filter((r) => r.referenceKind === 'calls');
    expect(calls.some((c) => c.referenceName === 'processData')).toBe(true);
  });
});

describe('Python Extraction', () => {
  it('should extract function definitions', () => {
    const code = `
def calculate_total(items: list, tax_rate: float) -> float:
    """Calculate total with tax."""
    subtotal = sum(item.price for item in items)
    return subtotal * (1 + tax_rate)
`;
    const result = extractFromSource('calc.py', code);

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      kind: 'function',
      name: 'calculate_total',
      language: 'python',
    });
  });

  it('should extract class definitions', () => {
    const code = `
class UserService:
    """Service for managing users."""

    def __init__(self, db):
        self.db = db

    def get_user(self, user_id: str) -> User:
        return self.db.find_user(user_id)
`;
    const result = extractFromSource('service.py', code);

    const classNode = result.nodes.find((n) => n.kind === 'class');
    expect(classNode).toBeDefined();
    expect(classNode?.name).toBe('UserService');
  });
});

describe('Go Extraction', () => {
  it('should extract function declarations', () => {
    const code = `
package main

func ProcessOrder(order Order) (Receipt, error) {
    // Process the order
    return Receipt{}, nil
}
`;
    const result = extractFromSource('main.go', code);

    const funcNode = result.nodes.find((n) => n.kind === 'function');
    expect(funcNode).toBeDefined();
    expect(funcNode?.name).toBe('ProcessOrder');
  });

  it('should extract method declarations', () => {
    const code = `
package main

type Service struct {
    db *Database
}

func (s *Service) GetUser(id string) (*User, error) {
    return s.db.FindUser(id)
}
`;
    const result = extractFromSource('service.go', code);

    const methodNode = result.nodes.find((n) => n.kind === 'method');
    expect(methodNode).toBeDefined();
    expect(methodNode?.name).toBe('GetUser');
  });
});

describe('Rust Extraction', () => {
  it('should extract function declarations', () => {
    const code = `
pub fn process_data(input: &str) -> Result<Output, Error> {
    // Process data
    Ok(Output::new())
}
`;
    const result = extractFromSource('lib.rs', code);

    const funcNode = result.nodes.find((n) => n.kind === 'function');
    expect(funcNode).toBeDefined();
    expect(funcNode?.name).toBe('process_data');
    expect(funcNode?.visibility).toBe('public');
  });

  it('should extract struct declarations', () => {
    const code = `
pub struct User {
    pub id: String,
    pub name: String,
    email: String,
}
`;
    const result = extractFromSource('models.rs', code);

    const structNode = result.nodes.find((n) => n.kind === 'struct');
    expect(structNode).toBeDefined();
    expect(structNode?.name).toBe('User');
  });

  it('should extract trait declarations', () => {
    const code = `
pub trait Repository {
    fn find(&self, id: &str) -> Option<Entity>;
    fn save(&mut self, entity: Entity) -> Result<(), Error>;
}
`;
    const result = extractFromSource('traits.rs', code);

    const traitNode = result.nodes.find((n) => n.kind === 'trait');
    expect(traitNode).toBeDefined();
    expect(traitNode?.name).toBe('Repository');
  });
});

describe('Java Extraction', () => {
  it('should extract class declarations', () => {
    const code = `
public class UserService {
    private final UserRepository repository;

    public UserService(UserRepository repository) {
        this.repository = repository;
    }

    public User getUser(String id) {
        return repository.findById(id);
    }
}
`;
    const result = extractFromSource('UserService.java', code);

    const classNode = result.nodes.find((n) => n.kind === 'class');
    expect(classNode).toBeDefined();
    expect(classNode?.name).toBe('UserService');
    expect(classNode?.visibility).toBe('public');
  });

  it('should extract method declarations', () => {
    const code = `
public class Calculator {
    public static int add(int a, int b) {
        return a + b;
    }
}
`;
    const result = extractFromSource('Calculator.java', code);

    const methodNode = result.nodes.find((n) => n.kind === 'method' && n.name === 'add');
    expect(methodNode).toBeDefined();
    expect(methodNode?.isStatic).toBe(true);
  });
});

describe('C# Extraction', () => {
  it('should extract class declarations', () => {
    const code = `
public class OrderService
{
    private readonly IOrderRepository _repository;

    public OrderService(IOrderRepository repository)
    {
        _repository = repository;
    }

    public async Task<Order> GetOrderAsync(string id)
    {
        return await _repository.FindByIdAsync(id);
    }
}
`;
    const result = extractFromSource('OrderService.cs', code);

    const classNode = result.nodes.find((n) => n.kind === 'class');
    expect(classNode).toBeDefined();
    expect(classNode?.name).toBe('OrderService');
    expect(classNode?.visibility).toBe('public');
  });
});

describe('PHP Extraction', () => {
  it('should extract class declarations', () => {
    const code = `<?php

class UserController
{
    private UserService $userService;

    public function __construct(UserService $userService)
    {
        $this->userService = $userService;
    }

    public function show(string $id): User
    {
        return $this->userService->find($id);
    }
}
`;
    const result = extractFromSource('UserController.php', code);

    const classNode = result.nodes.find((n) => n.kind === 'class');
    expect(classNode).toBeDefined();
    expect(classNode?.name).toBe('UserController');
  });
});

describe('Swift Extraction', () => {
  it('should extract class declarations', () => {
    const code = `
public class NetworkManager {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func fetchData(from url: URL) async throws -> Data {
        let (data, _) = try await session.data(from: url)
        return data
    }
}
`;
    const result = extractFromSource('NetworkManager.swift', code);

    const classNode = result.nodes.find((n) => n.kind === 'class');
    expect(classNode).toBeDefined();
    expect(classNode?.name).toBe('NetworkManager');
  });

  it('should extract function declarations', () => {
    const code = `
func calculateSum(_ numbers: [Int]) -> Int {
    return numbers.reduce(0, +)
}

public func formatCurrency(amount: Double) -> String {
    return String(format: "$%.2f", amount)
}
`;
    const result = extractFromSource('utils.swift', code);

    const functions = result.nodes.filter((n) => n.kind === 'function');
    expect(functions.length).toBeGreaterThanOrEqual(1);
  });

  it('should extract struct declarations', () => {
    const code = `
public struct User {
    let id: UUID
    var name: String
    var email: String

    func displayName() -> String {
        return name
    }
}
`;
    const result = extractFromSource('User.swift', code);

    const structNode = result.nodes.find((n) => n.kind === 'struct');
    expect(structNode).toBeDefined();
    expect(structNode?.name).toBe('User');
  });

  it('should extract protocol declarations', () => {
    const code = `
public protocol Repository {
    associatedtype Entity

    func find(id: String) async throws -> Entity?
    func save(_ entity: Entity) async throws
}
`;
    const result = extractFromSource('Repository.swift', code);

    const protocolNode = result.nodes.find((n) => n.kind === 'interface');
    expect(protocolNode).toBeDefined();
    expect(protocolNode?.name).toBe('Repository');
  });

  it('should extract extension declarations', () => {
    const code = `
extension String {
    func toSlug() -> String {
        return self.lowercased().replacingOccurrences(of: " ", with: "-")
    }

    var isBlank: Bool {
        return self.trimmingCharacters(in: .whitespaces).isEmpty
    }
}

extension Array where Element: Equatable {
    func containsDuplicates() -> Bool {
        return self.count != Set(self).count
    }
}
`;
    const result = extractFromSource('StringExtensions.swift', code);

    // Extensions are extracted as classes with the extended type name
    const stringExt = result.nodes.find((n) => n.kind === 'class' && n.name === 'String');
    expect(stringExt).toBeDefined();

    const arrayExt = result.nodes.find((n) => n.kind === 'class' && n.name === 'Array where Element: Equatable');
    expect(arrayExt).toBeDefined();
  });

  it('should extract actor declarations', () => {
    const code = `
actor BankAccount {
    private var balance: Double = 0

    func deposit(amount: Double) {
        balance += amount
    }

    func withdraw(amount: Double) -> Bool {
        guard balance >= amount else { return false }
        balance -= amount
        return true
    }

    func getBalance() -> Double {
        return balance
    }
}
`;
    const result = extractFromSource('BankAccount.swift', code);

    const actorNode = result.nodes.find((n) => n.kind === 'class' && n.name === 'BankAccount');
    expect(actorNode).toBeDefined();

    // Check methods are extracted
    const methods = result.nodes.filter((n) => n.kind === 'method');
    expect(methods.length).toBeGreaterThanOrEqual(3);
  });

  it('should extract properties (stored and computed)', () => {
    const code = `
struct Rectangle {
    var width: Double
    var height: Double

    var area: Double {
        return width * height
    }

    var perimeter: Double {
        get { return 2 * (width + height) }
    }
}
`;
    const result = extractFromSource('Rectangle.swift', code);

    const structNode = result.nodes.find((n) => n.kind === 'struct');
    expect(structNode).toBeDefined();
    expect(structNode?.name).toBe('Rectangle');

    // Properties should be extracted
    const properties = result.nodes.filter((n) => n.kind === 'property');
    expect(properties.length).toBeGreaterThanOrEqual(2);
  });

  it('should extract subscript declarations', () => {
    const code = `
struct Matrix {
    var data: [[Int]]

    subscript(row: Int, column: Int) -> Int {
        get { return data[row][column] }
        set { data[row][column] = newValue }
    }
}
`;
    const result = extractFromSource('Matrix.swift', code);

    const structNode = result.nodes.find((n) => n.kind === 'struct');
    expect(structNode).toBeDefined();

    // Subscript should be extracted as a method
    const subscript = result.nodes.find((n) => n.kind === 'method' && n.name === 'subscript');
    expect(subscript).toBeDefined();
  });

  it('should extract associated types in protocols', () => {
    const code = `
protocol Container {
    associatedtype Item
    associatedtype Index: Hashable

    func item(at index: Index) -> Item
    mutating func append(_ item: Item)
}
`;
    const result = extractFromSource('Container.swift', code);

    const protocolNode = result.nodes.find((n) => n.kind === 'interface');
    expect(protocolNode).toBeDefined();
    expect(protocolNode?.name).toBe('Container');

    // Associated types should be extracted as type_alias
    const typeAliases = result.nodes.filter((n) => n.kind === 'type_alias');
    expect(typeAliases.length).toBeGreaterThanOrEqual(2);
    expect(typeAliases.some((t) => t.name === 'Item')).toBe(true);
    expect(typeAliases.some((t) => t.name === 'Index')).toBe(true);
  });

  it('should extract typealias declarations', () => {
    const code = `
typealias StringDictionary = [String: Any]
typealias Completion<T> = (Result<T, Error>) -> Void
typealias Handler = () -> Void
`;
    const result = extractFromSource('TypeAliases.swift', code);

    const typeAliases = result.nodes.filter((n) => n.kind === 'type_alias');
    expect(typeAliases.length).toBeGreaterThanOrEqual(3);
    expect(typeAliases.some((t) => t.name === 'StringDictionary')).toBe(true);
    expect(typeAliases.some((t) => t.name === 'Completion')).toBe(true);
    expect(typeAliases.some((t) => t.name === 'Handler')).toBe(true);
  });

  it('should extract enum cases with associated values', () => {
    const code = `
enum NetworkError: Error {
    case invalidURL
    case timeout(seconds: Int)
    case httpError(statusCode: Int, message: String)
    case unknown(underlying: Error)
}
`;
    const result = extractFromSource('NetworkError.swift', code);

    const enumNode = result.nodes.find((n) => n.kind === 'enum');
    expect(enumNode).toBeDefined();
    expect(enumNode?.name).toBe('NetworkError');

    // Enum cases should be extracted as enum_member
    const members = result.nodes.filter((n) => n.kind === 'enum_member');
    expect(members.length).toBeGreaterThanOrEqual(4);
    expect(members.some((m) => m.name === 'invalidURL')).toBe(true);
    expect(members.some((m) => m.name === 'timeout')).toBe(true);
    expect(members.some((m) => m.name === 'httpError')).toBe(true);
  });

  it('should extract enum with raw values', () => {
    const code = `
enum HTTPMethod: String {
    case get = "GET"
    case post = "POST"
    case put = "PUT"
    case delete = "DELETE"
}

enum Priority: Int {
    case low = 0
    case medium = 1
    case high = 2
}
`;
    const result = extractFromSource('Enums.swift', code);

    const enums = result.nodes.filter((n) => n.kind === 'enum');
    expect(enums.length).toBe(2);
    expect(enums.some((e) => e.name === 'HTTPMethod')).toBe(true);
    expect(enums.some((e) => e.name === 'Priority')).toBe(true);

    const members = result.nodes.filter((n) => n.kind === 'enum_member');
    expect(members.length).toBeGreaterThanOrEqual(7);
  });

  it('should extract init declarations', () => {
    const code = `
class DatabaseConnection {
    private var connection: Connection?

    init(url: String) throws {
        self.connection = try Connection(url: url)
    }

    convenience init() {
        try? self.init(url: "default://localhost")
    }

    deinit {
        connection?.close()
    }
}
`;
    const result = extractFromSource('DatabaseConnection.swift', code);

    const classNode = result.nodes.find((n) => n.kind === 'class');
    expect(classNode).toBeDefined();

    // Init should be extracted as method
    const inits = result.nodes.filter((n) => n.kind === 'method' && n.name === 'init');
    expect(inits.length).toBeGreaterThanOrEqual(1);

    // Deinit should be extracted as method
    const deinit = result.nodes.find((n) => n.kind === 'method' && n.name === 'deinit');
    expect(deinit).toBeDefined();
  });

  it('should extract visibility modifiers correctly', () => {
    const code = `
public class APIClient {
    public var baseURL: URL
    internal let session: URLSession
    fileprivate var cache: [String: Data] = [:]
    private var apiKey: String

    public init(baseURL: URL, apiKey: String) {
        self.baseURL = baseURL
        self.apiKey = apiKey
        self.session = URLSession.shared
    }
}
`;
    const result = extractFromSource('APIClient.swift', code);

    const classNode = result.nodes.find((n) => n.kind === 'class');
    expect(classNode).toBeDefined();
    expect(classNode?.visibility).toBe('public');
  });

  it('should extract async functions', () => {
    const code = `
func fetchUser(id: String) async throws -> User {
    let data = try await network.fetch(endpoint: "/users/\(id)")
    return try JSONDecoder().decode(User.self, from: data)
}

func loadData() async {
    await process()
}
`;
    const result = extractFromSource('AsyncFunctions.swift', code);

    const functions = result.nodes.filter((n) => n.kind === 'function');
    expect(functions.length).toBeGreaterThanOrEqual(2);

    // Check async flag
    const asyncFunc = functions.find((f) => f.name === 'fetchUser');
    expect(asyncFunc).toBeDefined();
    expect(asyncFunc?.isAsync).toBe(true);
  });

  it('should extract static and class methods', () => {
    const code = `
class Factory {
    static func create() -> Factory {
        return Factory()
    }

    class func classMethod() -> String {
        return "class method"
    }

    func instanceMethod() -> String {
        return "instance method"
    }
}
`;
    const result = extractFromSource('Factory.swift', code);

    const classNode = result.nodes.find((n) => n.kind === 'class');
    expect(classNode).toBeDefined();

    const methods = result.nodes.filter((n) => n.kind === 'method');
    expect(methods.length).toBeGreaterThanOrEqual(2);

    // Check static flag
    const staticMethod = methods.find((m) => m.name === 'create');
    expect(staticMethod).toBeDefined();
    expect(staticMethod?.isStatic).toBe(true);
  });

  it('should track function calls', () => {
    const code = `
func main() {
    let user = fetchUser(id: "123")
    processData(user.data)
    print(user.name)
}
`;
    const result = extractFromSource('Main.swift', code);

    // Unresolved references should include function calls
    expect(result.unresolvedReferences.length).toBeGreaterThan(0);
    expect(result.unresolvedReferences.some((r) => r.referenceName === 'fetchUser')).toBe(true);
  });

  it('should extract protocol methods', () => {
    const code = `
protocol Drawable {
    var size: Double { get }
    func draw() -> Color
    func resize(to newSize: Double)
}
`;
    const result = extractFromSource('Drawable.swift', code);

    const protocolNode = result.nodes.find((n) => n.kind === 'interface');
    expect(protocolNode).toBeDefined();
    expect(protocolNode?.name).toBe('Drawable');

    // Protocol methods should be extracted
    const methods = result.nodes.filter((n) => n.kind === 'method');
    expect(methods.length).toBeGreaterThanOrEqual(2);
    expect(methods.some((m) => m.name === 'draw')).toBe(true);
    expect(methods.some((m) => m.name === 'resize')).toBe(true);

    // Protocol property should be extracted
    const properties = result.nodes.filter((n) => n.kind === 'property');
    expect(properties.some((p) => p.name === 'size')).toBe(true);
  });
});

describe('Kotlin Extraction', () => {
  it('should extract class declarations', () => {
    const code = `
class UserRepository(private val database: Database) {
    fun findById(id: String): User? {
        return database.query("SELECT * FROM users WHERE id = ?", id)
    }

    suspend fun save(user: User) {
        database.insert(user)
    }
}
`;
    const result = extractFromSource('UserRepository.kt', code);

    const classNode = result.nodes.find((n) => n.kind === 'class');
    expect(classNode).toBeDefined();
    expect(classNode?.name).toBe('UserRepository');
  });

  it('should extract function declarations', () => {
    const code = `
fun calculateTotal(items: List<Item>): Double {
    return items.sumOf { it.price }
}

suspend fun fetchUserData(userId: String): User {
    return api.getUser(userId)
}
`;
    const result = extractFromSource('utils.kt', code);

    const functions = result.nodes.filter((n) => n.kind === 'function');
    expect(functions.length).toBeGreaterThanOrEqual(1);
  });

  it('should detect suspend functions as async', () => {
    const code = `
suspend fun loadData(): List<String> {
    delay(1000)
    return listOf("a", "b", "c")
}
`;
    const result = extractFromSource('loader.kt', code);

    const funcNode = result.nodes.find((n) => n.kind === 'function');
    expect(funcNode).toBeDefined();
    expect(funcNode?.isAsync).toBe(true);
  });

  it('should extract data classes', () => {
    const code = `
data class User(val id: String, val name: String, val email: String)

data class Product(
    val id: Long,
    val name: String,
    val price: Double
)
`;
    const result = extractFromSource('models.kt', code);

    const classes = result.nodes.filter((n) => n.kind === 'class');
    expect(classes.length).toBeGreaterThanOrEqual(2);
    expect(classes.some((c) => c.name === 'User')).toBe(true);
    expect(classes.some((c) => c.name === 'Product')).toBe(true);
  });

  it('should extract sealed classes with subclasses', () => {
    const code = `
sealed class Result {
    data class Success(val value: String) : Result()
    data class Error(val message: String) : Result()
    object Loading : Result()
}
`;
    const result = extractFromSource('result.kt', code);

    const resultClass = result.nodes.find((n) => n.kind === 'class' && n.name === 'Result');
    expect(resultClass).toBeDefined();

    // Should also extract nested classes
    const successClass = result.nodes.find((n) => n.kind === 'class' && n.name === 'Success');
    const errorClass = result.nodes.find((n) => n.kind === 'class' && n.name === 'Error');
    expect(successClass).toBeDefined();
    expect(errorClass).toBeDefined();
  });

  it('should extract object declarations (singletons)', () => {
    const code = `
object DatabaseConfig {
    const val URL = "jdbc:mysql://localhost:3306/mydb"
    const val MAX_CONNECTIONS = 10

    fun connect(): Connection {
        return DriverManager.getConnection(URL)
    }
}
`;
    const result = extractFromSource('config.kt', code);

    const objectNode = result.nodes.find((n) => n.kind === 'class' && n.name === 'DatabaseConfig');
    expect(objectNode).toBeDefined();

    // Check for method inside object
    const connectMethod = result.nodes.find((n) => n.kind === 'method' && n.name === 'connect');
    expect(connectMethod).toBeDefined();
  });

  it('should extract companion objects', () => {
    const code = `
class Factory private constructor(val value: Int) {
    companion object {
        fun create(): Factory = Factory(42)
        fun createWithValue(v: Int): Factory = Factory(v)
    }
}
`;
    const result = extractFromSource('factory.kt', code);

    const factoryClass = result.nodes.find((n) => n.kind === 'class' && n.name === 'Factory');
    expect(factoryClass).toBeDefined();

    // Check for companion object
    const companionNode = result.nodes.find((n) => n.kind === 'class' && n.name === 'Companion');
    expect(companionNode).toBeDefined();

    // Check for methods in companion object
    const createMethod = result.nodes.find((n) => n.kind === 'method' && n.name === 'create');
    expect(createMethod).toBeDefined();
  });

  it('should extract interfaces', () => {
    const code = `
interface Repository<T> {
    fun findById(id: String): T?
    fun findAll(): List<T>
    suspend fun save(entity: T)
    suspend fun delete(id: String)
}

interface UserRepository : Repository<User> {
    fun findByEmail(email: String): User?
}
`;
    const result = extractFromSource('repository.kt', code);

    const interfaces = result.nodes.filter((n) => n.kind === 'interface');
    expect(interfaces.length).toBeGreaterThanOrEqual(2);
    expect(interfaces.some((i) => i.name === 'Repository')).toBe(true);
    expect(interfaces.some((i) => i.name === 'UserRepository')).toBe(true);
  });

  it('should extract enums with members and methods', () => {
    const code = `
enum class Status {
    PENDING,
    ACTIVE,
    COMPLETED;

    fun isTerminal(): Boolean = this == COMPLETED

    companion object {
        fun fromString(s: String): Status = valueOf(s)
    }
}
`;
    const result = extractFromSource('status.kt', code);

    const enumNode = result.nodes.find((n) => n.kind === 'enum' && n.name === 'Status');
    expect(enumNode).toBeDefined();

    // Check for enum members
    const enumMembers = result.nodes.filter((n) => n.kind === 'enum_member');
    expect(enumMembers.length).toBeGreaterThanOrEqual(3);
    expect(enumMembers.some((m) => m.name === 'PENDING')).toBe(true);
    expect(enumMembers.some((m) => m.name === 'ACTIVE')).toBe(true);
    expect(enumMembers.some((m) => m.name === 'COMPLETED')).toBe(true);
  });

  it('should extract extension functions', () => {
    const code = `
fun String.toSlug(): String {
    return this.lowercase().replace(" ", "-")
}

fun List<Int>.average(): Double {
    return this.sum().toDouble() / this.size
}

suspend fun <T> T.async(block: suspend () -> Unit) {
    block()
}
`;
    const result = extractFromSource('extensions.kt', code);

    const functions = result.nodes.filter((n) => n.kind === 'function');
    expect(functions.length).toBeGreaterThanOrEqual(2);
    expect(functions.some((f) => f.name === 'toSlug')).toBe(true);
    expect(functions.some((f) => f.name === 'average')).toBe(true);
  });

  it('should extract properties (val/var)', () => {
    const code = `
class Config {
    val readOnly: String = "immutable"
    var mutable: Int = 0
    private val secret: String = "hidden"

    val computed: Int
        get() = mutable * 2
}
`;
    const result = extractFromSource('config.kt', code);

    const properties = result.nodes.filter((n) => n.kind === 'property' || n.kind === 'constant');
    expect(properties.length).toBeGreaterThanOrEqual(3);
  });

  it('should extract type aliases', () => {
    const code = `
typealias UserId = String
typealias UserMap = Map<UserId, User>
typealias Predicate<T> = (T) -> Boolean
typealias Handler = suspend (Request) -> Response
`;
    const result = extractFromSource('types.kt', code);

    const typeAliases = result.nodes.filter((n) => n.kind === 'type_alias');
    expect(typeAliases.length).toBeGreaterThanOrEqual(4);
    expect(typeAliases.some((t) => t.name === 'UserId')).toBe(true);
    expect(typeAliases.some((t) => t.name === 'UserMap')).toBe(true);
    expect(typeAliases.some((t) => t.name === 'Predicate')).toBe(true);
    expect(typeAliases.some((t) => t.name === 'Handler')).toBe(true);
  });

  it('should extract class inheritance relationships', () => {
    const code = `
open class Animal(val name: String)

class Dog(name: String, val breed: String) : Animal(name), Comparable<Dog> {
    override fun compareTo(other: Dog): Int = name.compareTo(other.name)
}

class Cat(name: String) : Animal(name)
`;
    const result = extractFromSource('animals.kt', code);

    const dogClass = result.nodes.find((n) => n.kind === 'class' && n.name === 'Dog');
    expect(dogClass).toBeDefined();

    // Check for inheritance edges
    const extendsRefs = result.unresolvedReferences.filter((r) => r.referenceKind === 'extends');
    const implementsRefs = result.unresolvedReferences.filter((r) => r.referenceKind === 'implements');

    expect(extendsRefs.some((r) => r.referenceName === 'Animal')).toBe(true);
    expect(implementsRefs.some((r) => r.referenceName.includes('Comparable'))).toBe(true);
  });

  it('should extract visibility modifiers', () => {
    const code = `
class MyClass {
    public fun publicMethod() {}
    private fun privateMethod() {}
    protected fun protectedMethod() {}
    internal fun internalMethod() {}
}
`;
    const result = extractFromSource('visibility.kt', code);

    const methods = result.nodes.filter((n) => n.kind === 'method');

    const publicMethod = methods.find((m) => m.name === 'publicMethod');
    const privateMethod = methods.find((m) => m.name === 'privateMethod');
    const internalMethod = methods.find((m) => m.name === 'internalMethod');

    expect(publicMethod?.visibility).toBe('public');
    expect(privateMethod?.visibility).toBe('private');
    expect(internalMethod?.visibility).toBe('internal');
  });

  it('should extract abstract classes', () => {
    const code = `
abstract class Shape {
    abstract fun area(): Double
    abstract fun perimeter(): Double

    fun describe(): String = "I am a shape"
}
`;
    const result = extractFromSource('shape.kt', code);

    const shapeClass = result.nodes.find((n) => n.kind === 'class' && n.name === 'Shape');
    expect(shapeClass).toBeDefined();
    expect(shapeClass?.isAbstract).toBe(true);
  });

  it('should track function calls', () => {
    const code = `
fun main() {
    val result = processData()
    println(result)
    saveToDatabase(result)
}
`;
    const result = extractFromSource('main.kt', code);

    const calls = result.unresolvedReferences.filter((r) => r.referenceKind === 'calls');
    expect(calls.some((c) => c.referenceName === 'processData')).toBe(true);
    expect(calls.some((c) => c.referenceName === 'println')).toBe(true);
    expect(calls.some((c) => c.referenceName === 'saveToDatabase')).toBe(true);
  });
});

describe('Full Indexing', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('should index a TypeScript file', async () => {
    // Create test file
    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(
      path.join(srcDir, 'utils.ts'),
      `
export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}
`
    );

    // Initialize and index
    const cg = CodeGraph.initSync(tempDir);
    const result = await cg.indexAll();

    expect(result.success).toBe(true);
    expect(result.filesIndexed).toBe(1);
    expect(result.nodesCreated).toBeGreaterThanOrEqual(2);

    // Check nodes were stored
    const nodes = cg.getNodesInFile('src/utils.ts');
    expect(nodes.length).toBeGreaterThanOrEqual(2);

    const addFunc = nodes.find((n) => n.name === 'add');
    expect(addFunc).toBeDefined();
    expect(addFunc?.kind).toBe('function');

    cg.close();
  });

  it('should index multiple files', async () => {
    // Create test files
    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir);

    fs.writeFileSync(
      path.join(srcDir, 'math.ts'),
      `export function add(a: number, b: number) { return a + b; }`
    );

    fs.writeFileSync(
      path.join(srcDir, 'string.ts'),
      `export function capitalize(s: string) { return s.toUpperCase(); }`
    );

    // Initialize and index
    const cg = CodeGraph.initSync(tempDir);
    const result = await cg.indexAll();

    expect(result.success).toBe(true);
    expect(result.filesIndexed).toBe(2);

    const files = cg.getFiles();
    expect(files.length).toBe(2);

    cg.close();
  });

  it('should track file hashes for incremental updates', async () => {
    // Create initial file
    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'main.ts'), `export const x = 1;`);

    // Initialize and index
    const cg = CodeGraph.initSync(tempDir);
    await cg.indexAll();

    // Check file is tracked
    const file = cg.getFile('src/main.ts');
    expect(file).toBeDefined();
    expect(file?.contentHash).toBeDefined();

    // Modify file
    fs.writeFileSync(path.join(srcDir, 'main.ts'), `export const x = 2;`);

    // Check for changes
    const changes = cg.getChangedFiles();
    expect(changes.modified).toContain('src/main.ts');

    cg.close();
  });

  it('should sync and detect changes', async () => {
    // Create initial file
    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(
      path.join(srcDir, 'main.ts'),
      `export function original() { return 1; }`
    );

    // Initialize and index
    const cg = CodeGraph.initSync(tempDir);
    await cg.indexAll();

    const initialNodes = cg.getNodesInFile('src/main.ts');
    expect(initialNodes.some((n) => n.name === 'original')).toBe(true);

    // Modify file
    fs.writeFileSync(
      path.join(srcDir, 'main.ts'),
      `export function updated() { return 2; }`
    );

    // Sync
    const syncResult = await cg.sync();
    expect(syncResult.filesModified).toBe(1);

    // Check nodes were updated
    const updatedNodes = cg.getNodesInFile('src/main.ts');
    expect(updatedNodes.some((n) => n.name === 'updated')).toBe(true);
    expect(updatedNodes.some((n) => n.name === 'original')).toBe(false);

    cg.close();
  });
});
