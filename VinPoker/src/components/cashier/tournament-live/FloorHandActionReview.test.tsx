// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FloorHandActionReview, type ReviewAction } from "./FloorHandActionReview";

const actions: ReviewAction[] = [
  { action_order: 1, street: "preflop", seat_number: 4, display_name: "Test 4", action_type: "post_sb", action_amount: 100000 },
  { action_order: 2, street: "preflop", seat_number: 6, display_name: "Test 6", action_type: "post_bb", action_amount: 200000 },
  { action_order: 3, street: "preflop", seat_number: 8, display_name: "Test 8", action_type: "call", action_amount: 200000 },
  { action_order: 4, street: "flop", seat_number: 8, display_name: "Test 8", action_type: "check", action_amount: 0 },
];

const base = {
  handNumber: 12,
  tableName: "Bàn 5",
  potSize: 600000,
  buttonSeat: 2,
  seats: [{ seat_number: 4, display_name: "Test 4" }, { seat_number: 6, display_name: "Test 6" }, { seat_number: 8, display_name: "Test 8" }],
  actions,
  canEdit: true,
  isVoided: false,
};

afterEach(cleanup);

describe("FloorHandActionReview", () => {
  it("shows the full action order and opens the exact selected row", () => {
    const onEditAction = vi.fn();
    render(<FloorHandActionReview {...base} onEditAction={onEditAction} />);
    expect(screen.getByText("Bàn 5 · Hand #12")).toBeVisible();
    expect(screen.getByText(/Cảnh báo chưa chỉ rõ action sai/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /#3.*Ghế 8.*Call 200.000/ }));
    expect(screen.getByText(/Trước: #2.*Big blind 200.000/)).toBeVisible();
    expect(screen.getByText(/Sau: #4.*Check/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Xem bản nháp action #3" }));
    expect(onEditAction).toHaveBeenCalledWith(3);
  });

  it("does not offer correction for a voided hand", () => {
    render(<FloorHandActionReview {...base} canEdit={false} isVoided onEditAction={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /#3.*Ghế 8.*Call 200.000/ }));
    expect(screen.queryByRole("button", { name: /Sửa action/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Hand đã void: chỉ đối chiếu/)).toBeVisible();
  });

  it("does not select a different action that reused the reported order", () => {
    render(<FloorHandActionReview {...base} actions={actions.map((action) => ({ ...action, id: `new-${action.action_order}` }))}
      initialActionId="old-action-3" onEditAction={vi.fn()} />);
    expect(screen.getByText(/Action gốc không còn trong hand hiện tại/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Xem bản nháp action #3" })).not.toBeInTheDocument();
  });
  it('invalidates a manually selected action removed by a refreshed revision, even if its order is reused',()=>{
    const onEditAction=vi.fn(),original=actions.map(action=>({...action,id:`original-${action.action_order}`}));
    const mounted=render(<FloorHandActionReview {...base} actions={original} onEditAction={onEditAction}/>);
    fireEvent.click(screen.getByRole('button',{name:/#3.*Ghế 8.*Call/}));
    expect(screen.getByRole('button',{name:'Xem bản nháp action #3'})).toBeVisible();
    mounted.rerender(<FloorHandActionReview {...base} actions={original.map(action=>action.action_order===3?{...action,id:'replacement-3',action_type:'raise',action_amount:400000}:action)} onEditAction={onEditAction}/>);
    expect(screen.queryByRole('button',{name:'Xem bản nháp action #3'})).toBeNull();
    expect(onEditAction).not.toHaveBeenCalled();
  });
  it('follows the selected action ID rather than transferring selection to another action at its old order',()=>{
    const onEditAction=vi.fn(),original=actions.map(action=>({...action,id:`original-${action.action_order}`}));
    const mounted=render(<FloorHandActionReview {...base} actions={original} onEditAction={onEditAction}/>);
    fireEvent.click(screen.getByRole('button',{name:/#3.*Ghế 8.*Call/}));
    mounted.rerender(<FloorHandActionReview {...base} actions={original.map(action=>({...action,action_order:action.action_order===3?4:action.action_order===4?3:action.action_order}))} onEditAction={onEditAction}/>);
    fireEvent.click(screen.getByRole('button',{name:'Xem bản nháp action #4'}));
    expect(onEditAction).toHaveBeenCalledWith(4);
  });
  it('does not carry a manual selection into another hand with reused action orders',()=>{
    const mounted=render(<FloorHandActionReview {...base} onEditAction={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button',{name:/#3.*Ghế 8.*Call/}));
    mounted.rerender(<FloorHandActionReview {...base} handNumber={13} onEditAction={vi.fn()}/>);
    expect(screen.queryByRole('button',{name:'Xem bản nháp action #3'})).toBeNull();
  });
  it('does not label a manual substitute as the original reported action ID',()=>{
    render(<FloorHandActionReview {...base} initialActionId='removed-action' onEditAction={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button',{name:/#3.*Ghế 8.*Call/}));
    expect(screen.queryByText('Action gốc đã được chọn theo ID. Kiểm tra trước khi sửa.')).toBeNull();
    expect(screen.getByText(/Action gốc không còn trong hand hiện tại/)).toBeVisible();
  });
  it('keeps an explicit alternate-ID selection across equivalent refreshed arrays without pretending it is the reported ID',()=>{
    const original=actions.map(action=>({...action,id:`original-${action.action_order}`}));
    const mounted=render(<FloorHandActionReview {...base} actions={original} initialActionId='original-2' onEditAction={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button',{name:/#3.*Ghế 8.*Call/}));
    mounted.rerender(<FloorHandActionReview {...base} actions={original.map(action=>({...action}))} initialActionId='original-2' onEditAction={vi.fn()}/>);
    expect(screen.getByRole('button',{name:'Xem bản nháp action #3'})).toBeVisible();
    expect(screen.getByText(/Bạn đang đối chiếu action khác với action gốc/)).toBeVisible();
  });
  it('invalidates a legacy ID-less selection when the row snapshot changes',()=>{
    const mounted=render(<FloorHandActionReview {...base} onEditAction={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button',{name:/#3.*Ghế 8.*Call/}));
    mounted.rerender(<FloorHandActionReview {...base} actions={actions.map(action=>action.action_order===3?{...action,action_amount:500000}:action)} onEditAction={vi.fn()}/>);
    expect(screen.queryByRole('button',{name:'Xem bản nháp action #3'})).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Hãy chọn lại theo dữ liệu mới');
  });
});
