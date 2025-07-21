import './app.css'
import App from './App.svelte'
import { mount } from 'svelte'

const app = mount(App, {
  target: document.getElementById('app'),
})

// Load debugging utilities
if (typeof window !== 'undefined') {
  // Add debugging functions directly
  window.debugTodos = async function() {
    if (!window.app) {
      console.error('❌ window.app not available. Make sure P2P is initialized.')
      return
    }
    
    try {
      console.log('🔍 Starting todo database diagnostics...')
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
        console.log('Created By (formatted):', todo.createdBy ? `${todo.createdBy.slice(0, 5)}...` : 'unknown')
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
      
      return todos
      
    } catch (error) {
      console.error('❌ Error during todo diagnostics:', error)
    }
  }
  
  console.log('🎯 Debug function loaded! Run debugTodos() in the console to diagnose todo issues.')
}

export default app
