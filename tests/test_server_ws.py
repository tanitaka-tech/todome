from fastapi.routing import APIWebSocketRoute

import server
import server_ws


def test_app_registers_websocket_route():
    routes = [
        route
        for route in server.app.routes
        if isinstance(route, APIWebSocketRoute) and route.path == "/ws"
    ]
    assert len(routes) == 1
    assert routes[0].endpoint is server.websocket_endpoint


def test_message_handlers_cover_primary_flows():
    expected = {
        "kanban_move",
        "goal_edit",
        "life_log_start",
        "quota_log_start",
        "retro_message",
        "message",
    }
    assert expected.issubset(server_ws.MESSAGE_HANDLERS.keys())


def test_load_session_state_uses_core_loaders(monkeypatch):
    monkeypatch.setattr(server_ws.core, "load_tasks", lambda: [{"id": "t1"}])
    monkeypatch.setattr(server_ws.core, "load_goals", lambda: [{"id": "g1"}])
    monkeypatch.setattr(
        server_ws.core,
        "load_profile",
        lambda: {"currentState": "focus", "balanceWheel": []},
    )

    session = server_ws._load_session_state()

    assert session.kanban_tasks == [{"id": "t1"}]
    assert session.goals == [{"id": "g1"}]
    assert session.profile == {"currentState": "focus", "balanceWheel": []}
