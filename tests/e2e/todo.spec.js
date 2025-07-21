import { test, expect } from '@playwright/test'

// Bob's fixed PeerID for testing
const BOB_PEER_ID = '12D3KooWBob123456789abcdef123456789abcdef123456789abcdef123456789abcdef'

test.describe('P2P TODO Application', () => {
  test('Alice can add TODOs via UI and assign to Bob', async ({ page }) => {
    // Navigate to the application
    await page.goto('http://localhost:4173')

    // Wait for P2P initialization
    await page.waitForSelector('text=P2P TODO List', { timeout: 30000 })
    
    // Wait for loading to complete
    await page.waitForSelector('text=Add New TODO')

    // Test 1: Add three TODOs via UI
    const todos = ['Buy groceries', 'Walk the dog', 'Finish project']
    
    for (const todoText of todos) {
      // Fill the input
      await page.fill('input[placeholder="What needs to be done?"]', todoText)
      
      // Click add button
      await page.click('button:has-text("Add TODO")')
      
      // Verify the TODO appears in the list
      await expect(page.locator('text=' + todoText)).toBeVisible()
    }

    // Test 2: Verify all three TODOs are visible
    await expect(page.locator('text=TODO Items (3)')).toBeVisible()

    // Test 3: Assign one TODO to Bob's PeerID
    // Fill assignee field for the first TODO
    await page.fill('input[placeholder="What needs to be done?"]', 'Task assigned to Bob')
    await page.fill('input[placeholder="Assign to PeerID (optional)"]', BOB_PEER_ID)
    await page.click('button:has-text("Add TODO")')

    // Verify the assigned TODO shows Bob's PeerID
    await expect(page.locator(`text=Assigned to: ${BOB_PEER_ID.slice(0, 12)}`)).toBeVisible()

    // Test 4: Toggle completion status
    const firstCheckbox = page.locator('input[type="checkbox"]').first()
    await firstCheckbox.check()
    
    // Verify the TODO is marked as completed (has line-through style)
    await expect(page.locator('.line-through').first()).toBeVisible()

    // Test 5: Verify peer ID is displayed
    await expect(page.locator('text=My Peer ID')).toBeVisible()
    
    console.log('✅ Alice E2E test completed successfully - keeping browser open for Node.js test')
    
    // Keep the page open for the Node.js test to connect
    await page.waitForTimeout(60000) // Wait 1 minute for Node.js test to run
  })

  test('can interact with app via window.app API', async ({ page }) => {
    await page.goto('http://localhost:4173')
    
    // Wait for initialization
    await page.waitForSelector('text=Add New TODO')
    
    // Test adding TODO via window.app API
    await page.evaluate(async () => {
      await window.app.addTodo('API Todo Test')
    })
    
    // Verify the TODO appears
    await expect(page.locator('text=API Todo Test')).toBeVisible()
    
    // Test getting all todos
    const todosCount = await page.evaluate(async () => {
      const todos = await window.app.getAllTodos()
      return todos.length
    })
    
    expect(todosCount).toBeGreaterThan(0)
    
    // Test getting peer ID
    const peerId = await page.evaluate(() => {
      return window.app.getMyPeerId()
    })
    
    expect(peerId).toBeTruthy()
    expect(typeof peerId).toBe('string')
  })
})
