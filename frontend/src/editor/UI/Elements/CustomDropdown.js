/**
 * CustomDropdown - A reusable dropdown component that supports multi-row items
 * 
 * @example
 * const dropdown = new CustomDropdown({
 *     container: document.querySelector('.dropdown-container'),
 *     onChange: (value) => console.log('Selected:', value)
 * })
 * dropdown.addOption('value1', 'Label', 'Subtitle')
 * dropdown.selectOption('value1')
 */
export class CustomDropdown {
    /**
     * @param {Object} options
     * @param {HTMLElement} options.container - Container element for the dropdown
     * @param {Function} [options.onChange] - Callback when selection changes (value, label, subtitle)
     * @param {string} [options.placeholder='Select...'] - Placeholder text
     * @param {Object} [options.style] - Custom style overrides
     */
    constructor(options) {
        this.container = options.container
        this.onChange = options.onChange || (() => {})
        this.placeholder = options.placeholder || 'Select...'
        this.customStyle = options.style || {}
        
        this.selectedValue = null
        this.selectedLabel = null
        this.selectedSubtitle = null
        this.isOpen = false
        
        this._createElements()
        this._attachEvents()
    }
    
    _createElements() {
        // Clear container
        this.container.innerHTML = ''
        this.container.style.position = 'relative'
        
        // Display element (what's shown when closed)
        this.displayElement = document.createElement('div')
        this.displayElement.className = 'custom-dropdown-display'
        this.displayElement.style.cssText = `
            height: 30px;
            max-height: 30px;
            min-height: 30px;
            box-sizing: border-box;
            font-size: 11px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: #3c3c3c;
            border: 1px solid #3c3c3c;
            color: #f0f0f0;
            padding: 0 20px 0 4px;
            cursor: pointer;
            display: flex;
            align-items: center;
            white-space: nowrap;
            overflow: hidden;
            position: relative;
            user-select: none;
            line-height: 1;
            ${this._styleToString(this.customStyle.display || {})}
        `
        
        // Text container for label and subtitle
        this.textContainer = document.createElement('div')
        this.textContainer.style.cssText = 'display: flex; flex-direction: column; line-height: 1.2; overflow: hidden; width: 100%;' // Width 100% to fill container
        
        this.labelElement = document.createElement('span')
        this.labelElement.className = 'custom-dropdown-label'
        this.labelElement.textContent = this.placeholder
        
        this.subtitleElement = document.createElement('span')
        this.subtitleElement.className = 'custom-dropdown-subtitle'
        this.subtitleElement.style.cssText = 'font-size: 9px; color: #999; display: none;'
        
        this.textContainer.appendChild(this.labelElement)
        this.textContainer.appendChild(this.subtitleElement)
        
        // Arrow indicator
        this.arrowElement = document.createElement('span')
        this.arrowElement.className = 'custom-dropdown-arrow'
        this.arrowElement.style.cssText = 'position: absolute; right: 4px; pointer-events: none; font-size: 10px;'
        this.arrowElement.textContent = '▼'
        
        this.displayElement.appendChild(this.textContainer)
        this.displayElement.appendChild(this.arrowElement)
        
        // Dropdown container (appended to body to avoid overflow:hidden issues)
        this.dropdownElement = document.createElement('div')
        this.dropdownElement.className = 'custom-dropdown-list'
        this.dropdownElement.style.cssText = `
            display: none;
            position: fixed;
            background: #3c3c3c;
            border: 1px solid #454545;
            max-height: 300px;
            overflow-y: auto;
            z-index: 100000;
            box-shadow: 0 4px 6px rgba(0,0,0,0.3);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            ${this._styleToString(this.customStyle.dropdown || {})}
        `
        
        this.container.appendChild(this.displayElement)
        // Append dropdown to body instead of container to escape overflow:hidden
        document.body.appendChild(this.dropdownElement)
    }
    
    _styleToString(styleObj) {
        return Object.entries(styleObj)
            .map(([key, value]) => `${key.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}: ${value};`)
            .join(' ')
    }
    
    _attachEvents() {
        // Toggle dropdown on click
        this.displayElement.addEventListener('click', (e) => {
            e.stopPropagation()
            this.toggle()
        })
        
        // Close dropdown when clicking outside
        this._documentClickHandler = () => {
            if (this.isOpen) {
                this.close()
            }
        }
        document.addEventListener('click', this._documentClickHandler)
    }
    
    /**
     * Add an option to the dropdown
     * @param {string} value - Option value
     * @param {string} label - Primary label text
     * @param {string} [subtitle] - Secondary text below label
     * @param {boolean} [disabled=false] - Whether option is disabled
     * @param {boolean} [isConnected=false] - Show connected indicator
     * @param {boolean} [isOffline=false] - Show as offline (greyed out)
     */
    addOption(value, label, subtitle = null, disabled = false, isConnected = false, isOffline = false) {
        const option = document.createElement('div')
        option.className = 'custom-dropdown-option'
        option.dataset.value = value
        option.dataset.label = label
        if (subtitle) option.dataset.subtitle = subtitle
        
        const baseStyle = `
            padding: 4px 8px;
            cursor: ${disabled ? 'not-allowed' : 'pointer'};
            display: flex;
            flex-direction: column;
            user-select: none;
            font-size: 11px;
        `
        
        let colorStyle = ''
        if (disabled) {
            colorStyle = 'opacity: 0.5;'
        } else if (isOffline) {
            colorStyle = 'color: #888;'
        } else {
            colorStyle = 'color: #f0f0f0;'
        }
        
        option.style.cssText = baseStyle + colorStyle
        
        // Hover effect (only if not disabled)
        if (!disabled) {
            option.addEventListener('mouseenter', () => {
                option.style.background = '#094771'
            })
            option.addEventListener('mouseleave', () => {
                option.style.background = ''
            })
        }
        
        // Label row
        const labelRow = document.createElement('div')
        labelRow.style.cssText = 'line-height: 1.2;'
        labelRow.textContent = (isConnected ? '● ' : '') + label
        option.appendChild(labelRow)
        
        // Subtitle row
        if (subtitle) {
            const subtitleRow = document.createElement('div')
            subtitleRow.style.cssText = 'font-size: 9px; color: #999; line-height: 1.2; margin-top: 1px;'
            subtitleRow.textContent = subtitle
            option.appendChild(subtitleRow)
        }
        
        // Click handler
        if (!disabled) {
            option.addEventListener('click', (e) => {
                e.stopPropagation()
                this._handleOptionClick(value, label, subtitle)
            })
        }
        
        this.dropdownElement.appendChild(option)
        return option
    }
    
    /**
     * Add a separator/header element
     * @param {string} [text] - Text to display (optional, if empty shows just line)
     */
    addSeparator(text) {
        const separator = document.createElement('div')
        separator.className = 'custom-dropdown-separator'
        separator.style.cssText = `
            padding: ${text ? '4px 8px' : '0'};
            color: #666;
            border-top: 1px solid #555;
            font-size: 10px;
            user-select: none;
            font-weight: 600;
            margin-top: 4px;
            margin-bottom: 4px;
        `
        separator.textContent = text || ''
        this.dropdownElement.appendChild(separator)
        return separator
    }
    
    /**
     * Select an option by value
     * @param {string} value - Value to select
     * @param {string} [label] - Optional label (if not provided, will search options)
     * @param {string} [subtitle] - Optional subtitle
     * @param {boolean} [triggerCallback] - Whether to trigger onChange
     */
    selectOption(value, label = null, subtitle = null, triggerCallback = false) {
        // If label not provided, search for it in options
        if (!label) {
            const option = this.dropdownElement.querySelector(`[data-value="${value}"]`)
            if (option) {
                label = option.dataset.label
                subtitle = option.dataset.subtitle || null
            }
        }
        
        this.selectedValue = value
        this.selectedLabel = label || value
        this.selectedSubtitle = subtitle
        
        // Update display
        this.labelElement.textContent = label || value
        
        if (subtitle) {
            this.subtitleElement.textContent = subtitle
            this.subtitleElement.style.display = 'block'
            this.displayElement.style.padding = '2px 20px 2px 4px'
        } else {
            this.subtitleElement.style.display = 'none'
            this.displayElement.style.padding = '0 20px 0 4px'
        }
        
        // Trigger change callback
        if (triggerCallback && this.onChange) {
            this.onChange(value, label, subtitle)
        }
    }

    /**
     * Internal click handler
     * @param {*} value 
     * @param {*} label 
     * @param {*} subtitle 
     */
    _handleOptionClick(value, label, subtitle) {
        this.selectOption(value, label, subtitle, true)
        this.close()
    }

    /**
     * Get currently selected value
     */
    getValue() {
        return this.selectedValue
    }
    
    /**
     * Clear all options
     */
    clear() {
        this.dropdownElement.innerHTML = ''
    }
    
    /**
     * Open the dropdown
     */
    open() {
        this.isOpen = true
        
        // Position the dropdown based on the display element's position
        const rect = this.displayElement.getBoundingClientRect()
        this.dropdownElement.style.top = `${rect.bottom}px`
        this.dropdownElement.style.left = `${rect.left}px`
        this.dropdownElement.style.width = `${rect.width}px`
        
        this.dropdownElement.style.display = 'block'
        this.arrowElement.textContent = '▲'
    }
    
    /**
     * Close the dropdown
     */
    close() {
        this.isOpen = false
        this.dropdownElement.style.display = 'none'
        this.arrowElement.textContent = '▼'
    }
    
    /**
     * Toggle dropdown open/closed
     */
    toggle() {
        if (this.isOpen) {
            this.close()
        } else {
            this.open()
        }
    }
    
    /**
     * Enable the dropdown
     */
    enable() {
        this.displayElement.style.opacity = '1'
        this.displayElement.style.cursor = 'pointer'
        this.displayElement.style.pointerEvents = 'auto'
    }
    
    /**
     * Disable the dropdown
     */
    disable() {
        this.displayElement.style.opacity = '0.5'
        this.displayElement.style.cursor = 'not-allowed'
        this.displayElement.style.pointerEvents = 'none'
        this.close()
    }
    
    /**
     * Destroy the dropdown and clean up event listeners
     */
    destroy() {
        document.removeEventListener('click', this._documentClickHandler)
        this.container.innerHTML = ''
        // Remove dropdown from body
        if (this.dropdownElement && this.dropdownElement.parentNode) {
            this.dropdownElement.parentNode.removeChild(this.dropdownElement)
        }
    }
}
