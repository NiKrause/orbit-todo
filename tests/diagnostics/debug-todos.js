/**
 * Quick diagnostic script to check what's actually in the todo database
 */
console.log('🔍 Starting todo database diagnostics...')

// Check if we're in a browser environment
if (typeof window !== 'undefined' && window.app) {
    console.log('✅ Found window.app - running browser diagnostics')
    
    // Function to debug todos
    async function debugTodos() {
        try {
            console.log('📊 Getting all todos...')
            const todos = await window.app.getAllTodos()
            
            console.log('📈 Total todos found:', todos.length)
            
            if (todos.length === 0) {
                console.log('❌ No todos found in database')
                return
            }
            
            // Analyze each todo
            todos.forEach((todo, index) => {
                console.log(`\n--- Todo ${index + 1} ---`)
                console.log('ID:', todo.id)
                console.log('Text:', JSON.stringify(todo.text))
                console.log('Text type:', typeof todo.text)
                console.log('Text length:', todo.text ? todo.text.length : 'N/A')
                console.log('Assignee:', JSON.stringify(todo.assignee))
                console.log('Completed:', todo.completed)
                console.log('Created At:', todo.createdAt)
                console.log('Created By:', todo.createdBy)
                console.log('Full Object:', JSON.stringify(todo, null, 2))
                
                // Check for common issues
                const issues = []
                if (!todo.text) issues.push('Missing text')
                if (todo.text === '') issues.push('Empty text')
                if (!todo.id) issues.push('Missing ID')
                if (!todo.createdAt) issues.push('Missing createdAt')
                if (!todo.createdBy) issues.push('Missing createdBy')
                
                if (issues.length > 0) {
                    console.log('⚠️ Issues found:', issues.join(', '))
                } else {
                    console.log('✅ Todo appears healthy')
                }
            })
            
            // Test adding a new todo
            console.log('\n🧪 Testing todo creation...')
            const testTodo = await window.app.addTodo('Test todo for diagnostics', 'diagnostic-user')
            console.log('✅ Created test todo:', JSON.stringify(testTodo, null, 2))
            
            // Get todos again to see if it shows up
            console.log('\n🔄 Re-fetching todos after test creation...')
            const updatedTodos = await window.app.getAllTodos()
            console.log('📈 Total todos after test:', updatedTodos.length)
            
            const testTodoInList = updatedTodos.find(t => t.id === testTodo.id)
            if (testTodoInList) {
                console.log('✅ Test todo found in list:', JSON.stringify(testTodoInList, null, 2))
            } else {
                console.log('❌ Test todo NOT found in list!')
            }
            
        } catch (error) {
            console.error('❌ Error during todo diagnostics:', error)
        }
    }
    
    // Function to debug database health
    async function debugDatabaseHealth() {
        try {
            console.log('\n🏥 Running database health check...')
            const healthReport = await window.app.runDatabaseHealthCheck()
            
            console.log('Overall health:', healthReport.overall)
            console.log('Errors:', healthReport.errors)
            console.log('Recommendations:', healthReport.recommendations)
            
            // Check specific components
            if (healthReport.checks.todoDB) {
                console.log('\n📊 Todo Database Status:')
                console.log('Status:', healthReport.checks.todoDB.status)
                console.log('Details:', healthReport.checks.todoDB.details)
                console.log('Errors:', healthReport.checks.todoDB.errors)
            }
            
        } catch (error) {
            console.error('❌ Health check failed:', error)
        }
    }
    
    // Export functions to global scope for easy access
    window.debugTodos = debugTodos
    window.debugDatabaseHealth = debugDatabaseHealth
    
    console.log(`
🎯 Diagnostic functions loaded! Run these in the console:

1. debugTodos() - Check todo contents and test creation
2. debugDatabaseHealth() - Run comprehensive health check
3. window.app.getAllTodos() - Get all todos directly
4. window.app.addTodo('test', 'user') - Add a test todo

Example:
await debugTodos()
await debugDatabaseHealth()
    `)
    
} else {
    console.log('❌ Not in browser environment or window.app not available')
    console.log('Please run this script in the browser console after your app has loaded')
}
