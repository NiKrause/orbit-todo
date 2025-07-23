import { getTodoDatabase } from './database.js'
import { getLibP2P } from './network.js'

/**
 * Add a new todo item
 */
export async function addTodo(text, assignee = null, helia) {
  const db = await getTodoDatabase(helia)
  const libp2p = getLibP2P()
  
  try {
    // Validate input parameters
    if (!text || typeof text !== 'string') {
      throw new Error('Todo text must be a non-empty string')
    }
    
    if (assignee !== null && typeof assignee !== 'string') {
      throw new Error('Assignee must be a string or null')
    }
    
    const todoId = Date.now().toString()
    const todo = {
      text: String(text).trim(), // Ensure it's a clean string
      assignee: assignee ? String(assignee).trim() : null,
      completed: false,
      createdAt: new Date().toISOString(),
      createdBy: libp2p?.peerId?.toString() || 'unknown'
    }
    
    console.log('🔍 Attempting to add todo:', {
      id: todoId,
      todo: todo,
      todoType: typeof todo,
      textType: typeof todo.text,
      textLength: todo.text.length
    })
    
    // Validate the todo object before storing
    if (!todo.text || todo.text.length === 0) {
      throw new Error('Todo text cannot be empty after trimming')
    }
    
    // Test JSON serialization (OrbitDB might require serializable data)
    try {
      const testSerialization = JSON.stringify(todo)
      const testDeserialization = JSON.parse(testSerialization)
      console.log('✅ Todo serialization test passed:', testDeserialization)
    } catch (serializationError) {
      console.error('❌ Todo serialization failed:', serializationError)
      throw new Error(`Todo data is not serializable: ${serializationError.message}`)
    }
    
    // Store in OrbitDB with detailed error handling
    let hash
    try {
      console.log('💾 Storing todo in OrbitDB...', { id: todoId, data: todo })
      hash = await db.set(todoId, todo)
      console.log('✅ Todo stored successfully, hash:', hash)
    } catch (dbError) {
      console.error('❌ OrbitDB storage error:', {
        error: dbError,
        message: dbError.message,
        stack: dbError.stack,
        todoId: todoId,
        todoData: todo
      })
      throw new Error(`Failed to store todo in database: ${dbError.message}`)
    }
    
    console.log('🎉 Todo added successfully:', { id: todoId, ...todo }, 'Hash:', hash)
    
    return { id: todoId, ...todo }
    
  } catch (error) {
    console.error('❌ Error in addTodo:', {
      error: error,
      message: error.message,
      stack: error.stack,
      inputText: text,
      inputAssignee: assignee
    })
    throw error // Re-throw to be handled by the UI
  }
}

/**
 * Update an existing todo item
 */
export async function updateTodo(id, updates, helia) {
  const db = await getTodoDatabase(helia)
  const libp2p = getLibP2P()
  const existingTodo = await db.get(id)
  
  if (existingTodo) {
    const updatedTodo = {
      ...existingTodo,
      ...updates,
      updatedAt: new Date().toISOString(),
      updatedBy: libp2p?.peerId?.toString() || 'unknown'
    }
    
    const hash = await db.set(id, updatedTodo)
    console.log('Todo updated:', { id, ...updatedTodo }, 'Hash:', hash)
    
    return { id, ...updatedTodo }
  }
  
  throw new Error(`Todo with id ${id} not found`)
}

/**
 * Delete a todo item
 */
export async function deleteTodo(id, helia) {
  const db = await getTodoDatabase(helia)
  const existingTodo = await db.get(id)
  
  if (existingTodo) {
    let hash
    try {
      // Try different possible delete methods
      if (typeof db.delete === 'function') {
        hash = await db.delete(id)
      } else if (typeof db.del === 'function') {
        hash = await db.del(id)
      } else if (typeof db.remove === 'function') {
        hash = await db.remove(id)
      } else if (typeof db.set === 'function') {
        // For keyvalue stores, deletion might be setting to null/undefined
        hash = await db.set(id, null)
        console.log('ℹ️ Using set(key, null) for deletion')
      } else {
        throw new Error('No delete method found on database object')
      }
      console.log('Todo deleted:', id, 'Hash:', hash)
      return true
    } catch (error) {
      console.error('❌ Failed to delete todo:', error)
      throw error
    }
  }
  return false
}

/**
 * Get all todos from the database
 */
export async function getAllTodos(helia) {
  const db = await getTodoDatabase(helia)
  
  try {
    const allDocs = await db.all()
    console.log('🔍 Raw OrbitDB data:', allDocs)
    console.log('🔍 OrbitDB data type:', typeof allDocs, 'Is Array:', Array.isArray(allDocs))
    
    let todos = []
    
    // Handle different OrbitDB response formats
    if (Array.isArray(allDocs)) {
      // OrbitDB returns array of {hash, key, value} objects
      console.log('📋 Processing array format data...')
      todos = allDocs.map((doc, index) => {
        console.log(`Processing doc ${index}:`, doc)
        
        if (!doc || !doc.value || typeof doc.value !== 'object') {
          console.warn('⚠️ Invalid document structure:', doc)
          return null
        }
        
        const value = doc.value
        const key = doc.key
        
        const todo = {
          id: key,
          text: value.text || '',
          assignee: value.assignee || null,
          completed: Boolean(value.completed),
          createdAt: value.createdAt || new Date().toISOString(),
          createdBy: value.createdBy || 'unknown',
          updatedAt: value.updatedAt || null,
          updatedBy: value.updatedBy || null
        }
        
        console.log('✅ Processed todo:', todo)
        return todo
      }).filter(todo => todo !== null)
      
    } else if (allDocs && typeof allDocs === 'object') {
      // OrbitDB returns plain object with key-value pairs
      console.log('📋 Processing object format data...')
      todos = Object.entries(allDocs).map(([key, value]) => {
        if (!value || typeof value !== 'object') {
          console.warn('⚠️ Invalid todo data for key:', key, 'Value:', value)
          return null
        }
        
        const todo = {
          id: key,
          text: value.text || '',
          assignee: value.assignee || null,
          completed: Boolean(value.completed),
          createdAt: value.createdAt || new Date().toISOString(),
          createdBy: value.createdBy || 'unknown',
          updatedAt: value.updatedAt || null,
          updatedBy: value.updatedBy || null
        }
        
        return todo
      }).filter(todo => todo !== null)
    } else {
      console.warn('⚠️ Unexpected OrbitDB data format:', allDocs)
      return []
    }
    
    console.log('✅ Final processed todos:', todos.length, todos)
    return todos.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    
  } catch (error) {
    console.error('❌ Error fetching todos from OrbitDB:', error)
    return []
  }
}

/**
 * Debug function to inspect current todos in console
 */
export async function debugTodos(helia) {
  console.log('🐛 === DEBUG TODOS START ===')
  
  try {
    const db = await getTodoDatabase(helia)
    console.log('📊 Database info:', {
      address: db.address,
      type: db.type,
      open: db.opened,
      writable: db.access.write
    })
    
    console.log('🔍 Fetching raw database content...')
    const rawData = await db.all()
    console.log('📦 Raw OrbitDB data:', rawData)
    console.log('📈 Raw data stats:', {
      type: typeof rawData,
      isArray: Array.isArray(rawData),
      keys: Object.keys(rawData || {}),
      length: Array.isArray(rawData) ? rawData.length : Object.keys(rawData || {}).length
    })
    
    console.log('🔄 Processing todos...')
    const todos = await getAllTodos(helia)
    console.log('✅ Processed todos:', todos)
    console.log('📊 Todos stats:', {
      count: todos.length,
      sampleTodo: todos[0] || 'No todos found'
    })
    
  } catch (error) {
    console.error('❌ Debug error:', error)
  }
  
  console.log('🐛 === DEBUG TODOS END ===')
}
