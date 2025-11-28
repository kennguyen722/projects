package idm.user;

import idm.user.v1.*;
import io.grpc.stub.StreamObserver;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class UserServiceImplTest {

  private static class UnaryObserver<T> implements StreamObserver<T> {
    final AtomicReference<T> next = new AtomicReference<>();
    final List<Throwable> errors = new ArrayList<>();
    boolean completed = false;

    @Override public void onNext(T value) { next.set(value); }
    @Override public void onError(Throwable t) { errors.add(t); }
    @Override public void onCompleted() { completed = true; }
  }

  @Test
  void create_list_get_update_delete_flow() {
    UserServiceImpl svc = new UserServiceImpl();

    // Create
    var createObs = new UnaryObserver<UserResponse>();
    User user = User.newBuilder()
        .setUserName("demoUser")
        .setGivenName("Demo")
        .setFamilyName("User")
        .addEmails("demo@example.com")
        .setActive(true)
        .build();
    svc.createUser(CreateUserRequest.newBuilder().setUser(user).build(), createObs);
    assertThat(createObs.errors).isEmpty();
    assertThat(createObs.completed).isTrue();
    User created = createObs.next.get().getUser();
    assertThat(created.getId()).isNotBlank();
    assertThat(created.getUserName()).isEqualTo("demoUser");

    // List
    var listObs = new UnaryObserver<ListUsersResponse>();
    svc.listUsers(ListUsersRequest.newBuilder().setPage(1).setPageSize(100).build(), listObs);
    assertThat(listObs.errors).isEmpty();
    assertThat(listObs.completed).isTrue();
    assertThat(listObs.next.get().getTotal()).isEqualTo(1);

    // Get
    var getObs = new UnaryObserver<UserResponse>();
    svc.getUser(GetUserRequest.newBuilder().setId(created.getId()).build(), getObs);
    assertThat(getObs.errors).isEmpty();
    assertThat(getObs.completed).isTrue();
    assertThat(getObs.next.get().getUser().getUserName()).isEqualTo("demoUser");

    // Update
    User updatedUser = User.newBuilder(created)
        .setGivenName("Updated")
        .build();
    var updateObs = new UnaryObserver<UserResponse>();
    svc.updateUser(UpdateUserRequest.newBuilder().setUser(updatedUser).build(), updateObs);
    assertThat(updateObs.errors).isEmpty();
    assertThat(updateObs.completed).isTrue();
    assertThat(updateObs.next.get().getUser().getGivenName()).isEqualTo("Updated");

    // Delete
    var delObs = new UnaryObserver<DeleteUserResponse>();
    svc.deleteUser(DeleteUserRequest.newBuilder().setId(created.getId()).build(), delObs);
    assertThat(delObs.errors).isEmpty();
    assertThat(delObs.completed).isTrue();
    assertThat(delObs.next.get().getDeleted()).isTrue();

    // Get not found
    var getMissingObs = new UnaryObserver<UserResponse>();
    svc.getUser(GetUserRequest.newBuilder().setId("missing").build(), getMissingObs);
    assertThat(getMissingObs.errors)
        .singleElement()
        .isInstanceOf(NoSuchElementException.class);
  }
}
