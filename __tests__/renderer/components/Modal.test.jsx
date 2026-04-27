/**
 * Tests for Modal component
 * 
 * Tests the modal dialog UI component
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Modal from '../../../src/renderer/components/Modal';

describe('Modal component', () => {
  const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    onConfirm: jest.fn(),
    title: 'Test Modal',
    message: 'This is a test message'
  };
  
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  it('should render when isOpen is true', () => {
    render(<Modal {...defaultProps} />);
    
    expect(screen.getByText('Test Modal')).toBeInTheDocument();
    expect(screen.getByText('This is a test message')).toBeInTheDocument();
  });
  
  it('should not render when isOpen is false', () => {
    render(<Modal {...defaultProps} isOpen={false} />);
    
    expect(screen.queryByText('Test Modal')).not.toBeInTheDocument();
  });
  
  it('should display title prop', () => {
    render(<Modal {...defaultProps} title="Custom Title" />);
    
    expect(screen.getByText('Custom Title')).toBeInTheDocument();
  });
  
  it('should display message prop', () => {
    render(<Modal {...defaultProps} message="Custom message content" />);
    
    expect(screen.getByText('Custom message content')).toBeInTheDocument();
  });
  
  it('should render children instead of message when provided', () => {
    render(
      <Modal {...defaultProps} message="Should not appear">
        <div>Custom children content</div>
      </Modal>
    );
    
    expect(screen.getByText('Custom children content')).toBeInTheDocument();
    expect(screen.queryByText('Should not appear')).not.toBeInTheDocument();
  });
  
  it('should render Cancel button', () => {
    render(<Modal {...defaultProps} />);
    
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });
  
  it('should render Confirm button with default text', () => {
    render(<Modal {...defaultProps} />);
    
    expect(screen.getByText('Confirm')).toBeInTheDocument();
  });
  
  it('should render Confirm button with custom text', () => {
    render(<Modal {...defaultProps} confirmText="Delete" />);
    
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });
  
  it('should call onClose when Cancel button is clicked', async () => {
    const user = userEvent.setup();
    render(<Modal {...defaultProps} />);
    
    const cancelButton = screen.getByText('Cancel');
    await user.click(cancelButton);
    
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });
  
  it('should call onConfirm when Confirm button is clicked', async () => {
    const user = userEvent.setup();
    render(<Modal {...defaultProps} />);
    
    const confirmButton = screen.getByText('Confirm');
    await user.click(confirmButton);
    
    expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1);
  });
  
  it('should apply danger style to confirm button when confirmStyle is "danger"', () => {
    render(<Modal {...defaultProps} confirmStyle="danger" />);
    
    const confirmButton = screen.getByText('Confirm');
    expect(confirmButton).toHaveClass('bg-red-600', 'hover:bg-red-700');
  });
  
  it('should apply default style to confirm button when confirmStyle is not "danger"', () => {
    render(<Modal {...defaultProps} />);
    
    const confirmButton = screen.getByText('Confirm');
    expect(confirmButton).toHaveClass('bg-blue-600', 'hover:bg-blue-700');
  });
  
  it('should have backdrop and modal structure', () => {
    const { container } = render(<Modal {...defaultProps} />);
    
    // Check for backdrop
    const backdrop = container.firstChild;
    expect(backdrop).toHaveClass('fixed', 'inset-0', 'bg-black', 'bg-opacity-60');
    
    // Check for modal container
    const modalContainer = backdrop.firstChild;
    expect(modalContainer).toHaveClass('bg-gray-800', 'rounded-lg');
  });
  
  it('should not call handlers when isOpen is false', async () => {
    const { rerender } = render(<Modal {...defaultProps} isOpen={false} />);
    
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
    expect(screen.queryByText('Confirm')).not.toBeInTheDocument();
    expect(defaultProps.onClose).not.toHaveBeenCalled();
    expect(defaultProps.onConfirm).not.toHaveBeenCalled();
  });
});